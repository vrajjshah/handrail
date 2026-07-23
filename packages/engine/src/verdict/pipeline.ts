import { ModelError, type CostLedger, type ModelClient } from '@handrail/model';
import type { Finding, ModelErrorCode, Verification } from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';
import { sanitizeForPrompt } from '../judge/sanitize.js';
import type { TextJudgeCandidate } from '../judge/text-judge-schema.js';
import { CLAIM_FAMILY_SPECS, isClaimFamily } from '../judge/types.js';
import { buildAiFinding } from './ai-finding.js';
import { buildElementIndex, groundCandidate, type GroundedCandidate } from './grounding.js';
import type { HallucinationEntry } from './hallucination-ledger.js';
import { recheckCandidate, type RecheckResult } from './rechecks.js';
import { verifyCandidate, type VerifierDeps } from './verifier.js';

/**
 * Something the verdict pipeline could not do. Distinct from a *rejection*: a
 * rejected candidate is the pipeline working, a degradation is the pipeline
 * being unable to work, and only the second one belongs in the scan's
 * degradation list (trust invariant 1).
 */
export interface VerdictDegradation {
  reason: 'verifier-unavailable' | 'extract-truncated';
  detail: string;
  modelErrorCode?: ModelErrorCode;
}

export interface VerdictResult {
  findings: Finding[];
  /** Rows for `hallucination-ledger.json`. Never findings, never in the report. */
  rejected: HallucinationEntry[];
  degradations: VerdictDegradation[];
  /** Candidates in, before any stage rejected anything. */
  candidatesSeen: number;
}

export interface VerdictDeps {
  ledger: CostLedger;
  /**
   * The verifier's client. Kept separate from the judge's so a deployment can
   * point them at different providers — genuine independence, not just a
   * different prompt.
   */
  verifierClient: ModelClient;
}

export interface VerdictOptions {
  /**
   * Skip the model verifier. Every surviving candidate is then capped at
   * `needs-review`, because the tier matrix has nothing to raise it with.
   * Deterministic mode uses this; it is not a way to save money in hybrid mode.
   */
  skipModelVerifier?: boolean;
}

/** The check id a candidate's family reports under, even when the family is unknown. */
function checkIdFor(candidate: TextJudgeCandidate): string {
  return isClaimFamily(candidate.family)
    ? CLAIM_FAMILY_SPECS[candidate.family].checkId
    : `ai.${String(candidate.family)}`;
}

function entryFor(
  candidate: TextJudgeCandidate,
  capture: StateCapture,
  stage: HallucinationEntry['stage'],
  reason: HallucinationEntry['reason'],
  detail: string,
): HallucinationEntry {
  return {
    pageStateId: capture.pageStateId,
    url: capture.url,
    family: candidate.family,
    checkId: checkIdFor(candidate),
    claimedElemId: candidate.elemId.slice(0, 64),
    stage,
    reason,
    detail: sanitizeForPrompt(detail, 1000),
    confidence: candidate.confidence,
    claim: sanitizeForPrompt(candidate.problem, 600),
  };
}

/**
 * Stage 2: collapse candidates that describe the same thing.
 *
 * Keyed on `(family, elemId)` — the same element cannot fail the same criterion
 * twice. The survivor is the most confident claim, and `dedupeCount` records how
 * many the judge raised, which is a useful signal on its own: a judge that
 * describes one bad link four different ways is a judge with a prompt problem.
 */
export function dedupeGrounded(grounded: readonly GroundedCandidate[]): {
  merged: GroundedCandidate[];
  counts: Map<string, number>;
} {
  const best = new Map<string, GroundedCandidate>();
  const counts = new Map<string, number>();

  for (const entry of grounded) {
    const key = `${entry.spec.family}|${String(entry.element.elemId)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const incumbent = best.get(key);
    if (incumbent === undefined || entry.candidate.confidence > incumbent.candidate.confidence) {
      best.set(key, entry);
    }
  }

  return { merged: [...best.values()], counts };
}

/**
 * Combine the deterministic re-check and the model verifier into the
 * `Verification` the tier matrix reads.
 *
 * `confirmed` is the only status that lets an AI claim reach `likely`, and only
 * the *independent verifier* can produce it. A deterministic re-check confirms
 * the machine-decidable premise — that the link's name really is "Click here" —
 * not the judgment built on top of it, so on its own it leaves the finding at
 * `needs-review`: reported honestly, as something a human should look at.
 */
export function verificationFor(
  recheck: RecheckResult,
  verifierHeld: boolean | undefined,
  checkId: string,
): Verification {
  const recheckConfirmed = recheck.status === 'confirmed';

  let method: Verification['method'] = 'none';
  if (verifierHeld !== undefined) {
    method = recheckConfirmed ? 'deterministic-recheck+model-verifier' : 'model-verifier';
  } else if (recheckConfirmed) {
    method = 'deterministic-recheck';
  }

  let status: Verification['status'] = 'unverified';
  if (verifierHeld === true) status = 'confirmed';
  else if (verifierHeld === false) status = 'rejected';

  return {
    method,
    status,
    ...(recheckConfirmed ? { recheckedBy: checkId } : {}),
    note: recheck.detail.slice(0, 1000),
  };
}

/**
 * The verdict pipeline — the trust core.
 *
 * Every AI candidate has to survive all four stages, in order:
 *
 * 1. **Grounding** — the element must exist in the index, quoted markup must
 *    reproduce the snapshot at ≥90%, and cited attributes are re-read rather
 *    than trusted.
 * 2. **Dedupe/merge.**
 * 3. **Verification** — a deterministic re-check for the claim family, plus a
 *    separate fresh-context verifier answering a boolean rubric.
 * 4. **The hard tier matrix** — `tierCeilingFor()` in `@handrail/schemas`.
 *
 * Anything that falls out becomes a hallucination-ledger row. There is no path
 * from a rejection back to a finding, which is what makes "reported
 * hallucinations are structurally zero" a property of the code rather than a
 * claim about the model.
 */
export async function runVerdictPipeline(
  candidates: readonly TextJudgeCandidate[],
  capture: StateCapture,
  deps: VerdictDeps,
  options: VerdictOptions = {},
): Promise<VerdictResult> {
  const index = buildElementIndex(capture);
  const rejected: HallucinationEntry[] = [];
  const degradations: VerdictDegradation[] = [];

  // Stage 1 — grounding.
  const grounded: GroundedCandidate[] = [];
  for (const candidate of candidates) {
    const outcome = groundCandidate(candidate, capture, index);
    if (outcome.ok) {
      grounded.push(outcome.grounded);
      continue;
    }
    rejected.push(
      entryFor(
        candidate,
        capture,
        'grounding',
        outcome.rejection.reason,
        outcome.rejection.detail,
      ),
    );
  }

  // Stage 2 — dedupe/merge.
  const { merged, counts } = dedupeGrounded(grounded);

  // Stage 3 — verification. Stage 4, the tier matrix, is inside buildAiFinding.
  const findings: Finding[] = [];
  const verifierDeps: VerifierDeps = { ledger: deps.ledger, client: deps.verifierClient };

  for (const entry of merged) {
    const recheck = recheckCandidate(entry, capture);
    if (recheck.status === 'refuted') {
      rejected.push(
        entryFor(entry.candidate, capture, 'recheck', 'recheck-refuted', recheck.detail),
      );
      continue;
    }

    let verifierHeld: boolean | undefined;
    let verifierReason = 'the independent verifier declined to confirm the claim';
    if (options.skipModelVerifier !== true) {
      try {
        const verdict = await verifyCandidate(verifierDeps, entry, capture);
        verifierHeld = verdict.holds;
        verifierReason = verdict.reason;
      } catch (error) {
        // Trust invariant 1: an unreachable verifier is recorded and the finding
        // is capped, never silently promoted as though verification had passed.
        degradations.push({
          reason: 'verifier-unavailable',
          detail: `verifier failed for ${entry.spec.checkId} on ${String(entry.element.elemId)}: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 2000),
          ...(error instanceof ModelError ? { modelErrorCode: error.code } : {}),
        });
      }

      if (verifierHeld === false) {
        rejected.push(
          entryFor(
            entry.candidate,
            capture,
            'verification',
            'verifier-rejected',
            verifierReason,
          ),
        );
        continue;
      }
    }

    const key = `${entry.spec.family}|${String(entry.element.elemId)}`;
    findings.push(
      buildAiFinding(
        {
          grounded: entry,
          verification: verificationFor(recheck, verifierHeld, entry.spec.checkId),
          dedupeCount: counts.get(key) ?? 1,
        },
        capture,
      ),
    );
  }

  return { findings, rejected, degradations, candidatesSeen: candidates.length };
}
