import type { ElementRecord, StateCapture } from '../capture/types.js';
import type { TextJudgeCandidate } from '../judge/text-judge-schema.js';
import { CLAIM_FAMILY_SPECS, isClaimFamily, type ClaimFamilySpec } from '../judge/types.js';
import { bestMatchRatio, normalizeMarkup } from './fuzzy.js';

/**
 * Why a candidate never became a finding.
 *
 * Every one of these is a row in `hallucination-ledger.json`. They are named
 * after what the pipeline *observed*, not after how bad it was, because the
 * ledger's job is telemetry: "the judge quoted markup that is not on the page
 * eleven times this week" is an actionable prompt-quality signal, and
 * "rejected" is not.
 */
export const REJECTION_REASONS = [
  /** The candidate named an `elemId` that is not in the element index. */
  'unknown-element',
  /** The candidate named a claim family the judge is not allowed to raise. */
  'unknown-family',
  /** Quoted markup did not match the captured snapshot closely enough. */
  'dom-quote-mismatch',
  /** The candidate rested on an attribute the element does not carry. */
  'attribute-absent',
  /** The candidate quoted an attribute value that is not what the snapshot says. */
  'attribute-value-mismatch',
  /** The deterministic re-check for this family contradicted the claim. */
  'recheck-refuted',
  /** The independent verifier declined to confirm the claim. */
  'verifier-rejected',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** The plan's threshold: a quote must reproduce the snapshot at 90% or better. */
export const DOM_QUOTE_THRESHOLD = 0.9;

export interface GroundedCandidate {
  candidate: TextJudgeCandidate;
  spec: ClaimFamilySpec;
  /** The indexed element, read from the capture — never reconstructed from the claim. */
  element: ElementRecord;
  /**
   * The attributes the candidate cited, with the values **re-read from the
   * snapshot**. Downstream evidence and prose use these, so even a candidate
   * whose claimed values happened to be right contributes no text of its own.
   */
  groundedAttributes: Record<string, string>;
  /** How closely `quotedDom` matched the snapshot, or null when nothing was quoted. */
  domQuoteRatio: number | null;
}

export interface GroundingRejection {
  reason: RejectionReason;
  detail: string;
}

export type GroundingOutcome =
  | { ok: true; grounded: GroundedCandidate }
  | { ok: false; rejection: GroundingRejection };

function normalizeAttributeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether a claimed attribute value is the one the page actually carries.
 *
 * The one piece of tolerance is for boolean attributes: the DOM records
 * `required` as the empty string, and a model that reports it as `"true"` is
 * describing the page correctly even though the strings differ. Everything else
 * is compared as written (whitespace- and case-normalised).
 */
function attributeValueMatches(claimed: string, actual: string, name: string): boolean {
  const a = normalizeAttributeValue(claimed);
  const b = normalizeAttributeValue(actual);
  if (a === b) return true;
  if (b === '') return a === 'true' || a === name.toLowerCase();
  return false;
}

/**
 * Stage 1 of the verdict pipeline.
 *
 * This is the stage that makes "reported hallucinations are structurally zero" a
 * property of the system rather than a hope about the model. Three things are
 * checked, in increasing cost:
 *
 * 1. **The element must exist.** `elemId` is matched against the index the
 *    capture produced. There is no fuzzy fallback and no "closest element" —
 *    a model that invents an id has invented the whole claim with it.
 * 2. **Quoted markup must reproduce the snapshot at ≥90%.** Below that, the
 *    quote is not a quote.
 * 3. **Claimed attributes are re-read from the snapshot.** A claim resting on an
 *    attribute the element does not have is rejected; a claim whose attribute
 *    values were right is kept, but the *snapshot's* values are what travel
 *    downstream. Nothing a model typed becomes evidence.
 */
export function groundCandidate(
  candidate: TextJudgeCandidate,
  capture: StateCapture,
  index?: ReadonlyMap<string, ElementRecord>,
): GroundingOutcome {
  if (!isClaimFamily(candidate.family)) {
    return {
      ok: false,
      rejection: {
        reason: 'unknown-family',
        detail: `claim family "${String(candidate.family)}" is not one the text judge may raise`,
      },
    };
  }
  const spec = CLAIM_FAMILY_SPECS[candidate.family];

  const byId = index ?? buildElementIndex(capture);
  const element = byId.get(candidate.elemId);
  if (element === undefined) {
    return {
      ok: false,
      rejection: {
        reason: 'unknown-element',
        detail: `elemId "${candidate.elemId}" is not in the element index for ${capture.pageStateId}`,
      },
    };
  }

  let domQuoteRatio: number | null = null;
  if (candidate.quotedDom !== undefined && candidate.quotedDom.trim().length > 0) {
    domQuoteRatio = quoteRatio(candidate.quotedDom, element, capture);
    if (domQuoteRatio < DOM_QUOTE_THRESHOLD) {
      return {
        ok: false,
        rejection: {
          reason: 'dom-quote-mismatch',
          detail: `quoted markup matched the snapshot at ${domQuoteRatio.toFixed(2)}, under the ${String(DOM_QUOTE_THRESHOLD)} threshold`,
        },
      };
    }
  }

  const groundedAttributes: Record<string, string> = {};
  for (const claimed of candidate.claimedAttributes) {
    const actual = element.attributes[claimed.name];
    if (actual === undefined) {
      return {
        ok: false,
        rejection: {
          reason: 'attribute-absent',
          detail: `claim cites @${claimed.name} but ${element.tag} (${element.elemId}) does not carry it`,
        },
      };
    }
    if (!attributeValueMatches(claimed.value, actual, claimed.name)) {
      return {
        ok: false,
        rejection: {
          reason: 'attribute-value-mismatch',
          detail: `claim cites @${claimed.name} as quoted, but the snapshot holds a different value`,
        },
      };
    }
    groundedAttributes[claimed.name] = actual;
  }

  return { ok: true, grounded: { candidate, spec, element, groundedAttributes, domQuoteRatio } };
}

/** The element index as a lookup. Build it once per state when grounding a batch. */
export function buildElementIndex(capture: StateCapture): ReadonlyMap<string, ElementRecord> {
  return new Map(capture.elements.map((el) => [String(el.elemId), el]));
}

/**
 * Canonical markup for an indexed element.
 *
 * The capture stores a whole-document HTML snapshot and a structured index, but
 * not per-element markup, so a quote is matched against both: this
 * reconstruction (which catches a faithful quote of an element the serialiser
 * wrote differently) and the document snapshot itself (which catches a verbatim
 * quote). Taking the better of the two is deliberate — a quote only has to be
 * right *somewhere* in the captured state to be a quote.
 */
export function canonicalMarkup(element: ElementRecord): string {
  const attrs = Object.entries(element.attributes)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  const text = element.text ?? '';
  return `<${element.tag}${attrs}>${text}</${element.tag}>`;
}

function quoteRatio(quote: string, element: ElementRecord, capture: StateCapture): number {
  const normalized = normalizeMarkup(quote);
  if (normalized.length === 0) return 0;
  return Math.max(
    bestMatchRatio(quote, canonicalMarkup(element)),
    bestMatchRatio(quote, capture.html),
  );
}
