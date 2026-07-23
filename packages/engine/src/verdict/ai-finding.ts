import { createHash } from 'node:crypto';

import {
  FindingSchema,
  findingId,
  minTier,
  tierCeilingFor,
  type Evidence,
  type Finding,
  type FindingInput,
  type ScId,
  type Tier,
  type Verification,
} from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';
import { sanitizeForPrompt } from '../judge/sanitize.js';
import { canonicalMarkup, type GroundedCandidate } from './grounding.js';

const MAX_DESCRIPTION = 600;
const MAX_DOM_EXCERPT = 4000;

function deterministicFindingId(pageStateId: string, checkId: string, anchor: string): string {
  const digest = createHash('sha256').update(`${pageStateId}|${checkId}|${anchor}`).digest('hex');
  return `find_${digest.slice(0, 16)}`;
}

export interface AiFindingSpec {
  grounded: GroundedCandidate;
  verification: Verification;
  /** How many merged candidates this finding stands for. */
  dedupeCount: number;
}

/**
 * Turn a grounded, verified candidate into a `Finding`.
 *
 * Three things here are the trust core made concrete:
 *
 * - **The evidence is re-derived from the snapshot**, not copied from the model.
 *   Even when the judge quoted the markup perfectly, what ships is the capture's
 *   own serialisation of the indexed element. Nothing a model typed becomes
 *   evidence.
 * - **The tier is the minimum of what we would claim and what `tierCeilingFor`
 *   permits.** That function is the hard matrix from the plan; it lives in
 *   `@handrail/schemas` and it is called, never re-implemented. For an
 *   `ai-text` source with DOM (non-deterministic) evidence, the best attainable
 *   outcome is `likely`, and only with `verification.status === 'confirmed'`.
 * - **Remediation wording is marked `suggested`.** It came from a model; a
 *   reader is entitled to know that before pasting it into their codebase.
 */
export function buildAiFinding(spec: AiFindingSpec, capture: StateCapture): Finding {
  const { grounded, verification } = spec;
  const { element, candidate } = grounded;

  const evidence: Evidence[] = [
    {
      kind: 'dom',
      excerpt: canonicalMarkup(element).slice(0, MAX_DOM_EXCERPT),
      selector: element.selector,
    },
  ];

  const requested: Tier = 'likely';
  const ceiling = tierCeilingFor({ source: ['ai-text'], evidence, verification });
  const tier = minTier(requested, ceiling);

  // The description is model prose that may quote page content back at us, so it
  // goes through the same neutralisation as anything else DOM-derived. Report
  // renderers escape on output as well; this is the layer that stops a control
  // character or a fence from ever entering the artifact in the first place.
  const description = sanitizeForPrompt(candidate.problem, MAX_DESCRIPTION);
  const remediationSummary =
    candidate.remediation === undefined || candidate.remediation.trim().length === 0
      ? undefined
      : sanitizeForPrompt(candidate.remediation, MAX_DESCRIPTION);

  const input: FindingInput = {
    id: findingId(
      deterministicFindingId(capture.pageStateId, grounded.spec.checkId, element.xpath),
    ),
    checkId: grounded.spec.checkId,
    source: 'ai-text',
    sc: grounded.spec.sc as unknown as ScId[],
    scPrimary: grounded.spec.sc[0] as unknown as ScId,
    tier,
    severity: candidate.severity ?? grounded.spec.defaultSeverity,
    confidence: candidate.confidence,
    evidence,
    element: {
      elementId: element.elemId,
      selector: element.selector,
      xpath: element.xpath,
      domExcerpt: canonicalMarkup(element).slice(0, MAX_DOM_EXCERPT),
      ...(element.bbox !== null ? { bbox: element.bbox } : {}),
      ...(element.accessibleName !== null ? { accessibleName: element.accessibleName } : {}),
      ...(element.role !== null ? { role: element.role } : {}),
    },
    page: {
      url: capture.url,
      pageStateId: capture.pageStateId,
      viewport: capture.viewport.label,
    },
    verification,
    dedupeCount: spec.dedupeCount,
    description: description.length > 0 ? description : 'The text judge raised a claim with no description.',
    ...(remediationSummary === undefined
      ? {}
      : { remediation: { summary: remediationSummary, suggested: true } }),
  };

  return FindingSchema.parse(input);
}
