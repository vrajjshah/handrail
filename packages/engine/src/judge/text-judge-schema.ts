import { z } from 'zod';

import { CLAIM_FAMILIES } from './types.js';

/**
 * One attribute the judge says it read.
 *
 * Modelled as a list of name/value pairs rather than a free-form object because
 * the verdict pipeline re-reads every one of them from the snapshot: a claim
 * resting on an attribute the page does not actually have is a hallucination
 * with a paper trail, and that is easier to check pair-by-pair than over a map.
 */
export const ClaimedAttributeSchema = z.object({
  name: z.string().min(1).max(64),
  value: z.string().max(512),
});
export type ClaimedAttribute = z.infer<typeof ClaimedAttributeSchema>;

export const TextJudgeCandidateSchema = z.object({
  family: z.enum(CLAIM_FAMILIES),
  /** Must be an `id` from the extract. Grounding rejects anything else. */
  elemId: z.string().min(1).max(64),
  /** Optional verbatim markup the judge says it is quoting. Fuzzy-matched against the snapshot. */
  quotedDom: z.string().max(600).optional(),
  claimedAttributes: z.array(ClaimedAttributeSchema).max(8).default([]),
  /** What is wrong, in one or two sentences a report reader can act on. */
  problem: z.string().min(1).max(600),
  /** What to do about it. Always marked `suggested` on the finding — it is model wording. */
  remediation: z.string().max(600).optional(),
  severity: z.enum(['critical', 'serious', 'moderate', 'minor']).optional(),
  confidence: z.number().min(0).max(1),
});
export type TextJudgeCandidate = z.infer<typeof TextJudgeCandidateSchema>;

/**
 * The judge's whole reply. One call covers every family for the whole state, so
 * the cap is per-state rather than per-family: a page that genuinely has fifty
 * bad links has a different problem, and truncating the list is more honest than
 * paying for a thousand-candidate response.
 */
export const TextJudgeOutputSchema = z.object({
  candidates: z.array(TextJudgeCandidateSchema).max(50),
});
export type TextJudgeOutput = z.infer<typeof TextJudgeOutputSchema>;

/** The verifier's boolean rubric. Nothing free-form decides anything. */
export const VerifierOutputSchema = z.object({
  /** The element in the claim exists and is the kind of element the claim is about. */
  elementMatchesClaim: z.boolean(),
  /** The problem described is present in the facts shown, not inferred from elsewhere. */
  problemPresentInEvidence: z.boolean(),
  /** The criterion cited is the right one for this problem. */
  criterionApplies: z.boolean(),
  /** The single answer the pipeline acts on. */
  holds: z.boolean(),
  reason: z.string().min(1).max(400),
});
export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;
