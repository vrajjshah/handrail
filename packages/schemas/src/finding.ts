import { z } from 'zod';

import { EvidenceSchema, VerificationSchema, isDeterministicEvidence } from './evidence.js';
import {
  BoundingBoxSchema,
  CheckIdSchema,
  ConfidenceSchema,
  ElementIdSchema,
  FindingIdSchema,
  PageStateIdSchema,
  ScIdSchema,
  ViewportLabelSchema,
} from './primitives.js';

/** A heuristic source names the check that produced it, e.g. "heuristic:kbd.walk". */
export type HeuristicSource = `heuristic:${string}`;

/**
 * A template literal rather than `z.custom`.
 *
 * Both give the `heuristic:${string}` type and the same strictness, but a
 * `z.custom` is opaque to `z.toJSONSchema` — it makes the whole `Finding`
 * unrepresentable, and with it every schema that contains one. That matters
 * because the hosted API's OpenAPI document is *generated* from these
 * contracts; a contract that cannot be described is a contract the API can
 * drift from without anything noticing.
 */
const HeuristicSourceSchema = z.templateLiteral([
  'heuristic:',
  z.string().regex(/^[a-z][a-z0-9]*\.[a-z0-9-]+$/, 'expected a check id like "kbd.walk"'),
]);

export const DeterministicSourceSchema = z.union([
  z.enum(['axe', 'eslint', 'typecheck']),
  HeuristicSourceSchema,
]);

export const AiSourceSchema = z.enum(['ai-text', 'ai-vision']);
export type AiSource = z.infer<typeof AiSourceSchema>;

export const FindingSourceSchema = z.union([DeterministicSourceSchema, AiSourceSchema]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export function isAiSource(source: FindingSource): source is AiSource {
  return source === 'ai-text' || source === 'ai-vision';
}

/**
 * One source or several, always read as a list.
 *
 * A `z.codec` rather than a `z.preprocess`, because a preprocess is a
 * *unidirectional* transform: a schema containing one can be parsed but not
 * encoded, and the hosted API's response serializer encodes — so a `Finding`
 * with a preprocess anywhere inside it is a 500 at serialization time, not a
 * type error at build time. Found exactly that way.
 *
 * Encoding always emits the array form, which is itself valid input, so the
 * round trip is lossless in both directions.
 */
const FindingSourceListSchema = z.codec(
  z.union([FindingSourceSchema, z.array(FindingSourceSchema).min(1)]),
  z.array(FindingSourceSchema).min(1),
  {
    decode: (value) => (Array.isArray(value) ? value : [value]),
    encode: (sources) => sources,
  },
);

/**
 * Confidence tier. This is the single most load-bearing field in the product:
 * it is what a reader trusts, and it is never set by a language model directly.
 *
 * - `violation`    — deterministic evidence. Handrail measured it.
 * - `likely`       — a model claimed it and an independent verifier agreed.
 * - `needs-review` — everything else. Surfaced honestly, never hidden.
 */
export const TierSchema = z.enum(['violation', 'likely', 'needs-review']);
export type Tier = z.infer<typeof TierSchema>;

const TIER_RANK: Record<Tier, number> = {
  'needs-review': 0,
  likely: 1,
  violation: 2,
};

/** Returns the lower (more conservative) of two tiers. */
export function minTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export const SeveritySchema = z.enum(['critical', 'serious', 'moderate', 'minor']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingElementSchema = z.object({
  elementId: ElementIdSchema.optional(),
  selector: z.string().min(1),
  xpath: z.string().min(1).optional(),
  domExcerpt: z.string().min(1).max(4000).optional(),
  bbox: BoundingBoxSchema.optional(),
  accessibleName: z.string().optional(),
  role: z.string().optional(),
});

export const FindingPageSchema = z.object({
  url: z.url(),
  pageStateId: PageStateIdSchema,
  viewport: ViewportLabelSchema,
});

export const SourceRefSchema = z.object({
  file: z.string().min(1),
  line: z.int().positive(),
  /** How sure the selector-to-source matcher is. Drives whether a fix is auto-applied. */
  confidence: ConfidenceSchema,
});

export const RemediationSchema = z.object({
  summary: z.string().min(1).max(2000),
  snippets: z
    .object({
      html: z.string().optional(),
      react: z.string().optional(),
      vue: z.string().optional(),
    })
    .default({}),
  sourceRef: SourceRefSchema.optional(),
  /** True when the wording came from a model and a human should read it before shipping. */
  suggested: z.boolean().default(false),
});

/**
 * The raw shape of a finding, before the tier invariant is applied.
 * Use this when you need to `.extend()`; use {@link FindingSchema} to parse.
 */
export const FindingObjectSchema = z
  .object({
    id: FindingIdSchema,
    checkId: CheckIdSchema,
    /** One or more producers. Normalised to an array even when a single source is given. */
    source: FindingSourceListSchema,
    sc: z.array(ScIdSchema).min(1),
    scPrimary: ScIdSchema,
    tier: TierSchema,
    severity: SeveritySchema,
    confidence: ConfidenceSchema,
    evidence: z.array(EvidenceSchema),
    element: FindingElementSchema.optional(),
    page: FindingPageSchema,
    verification: VerificationSchema,
    remediation: RemediationSchema.optional(),
    /** How many identical instances this finding stands for after component dedupe. */
    dedupeCount: z.int().positive().default(1),
    /** Populated for site-level findings that recur across pages. */
    pages: z.array(z.url()).optional(),
    description: z.string().min(1).max(4000),
  })
  .check((ctx) => {
    if (!ctx.value.sc.includes(ctx.value.scPrimary)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['scPrimary'],
        message: 'scPrimary must be one of the criteria listed in sc',
      });
    }
  });

export type FindingInput = z.input<typeof FindingObjectSchema>;
export type Finding = z.output<typeof FindingObjectSchema>;

/**
 * The hard tier matrix from the trust core: the highest tier a finding is
 * *allowed* to claim, given who produced it and what they can show.
 *
 * The verdict pipeline calls this after grounding and verification. Note that
 * {@link FindingSchema} deliberately enforces only the evidence rule — the rest
 * of the matrix needs verification state the schema layer has no business judging.
 */
export function tierCeilingFor(finding: {
  source: readonly FindingSource[];
  evidence: readonly z.infer<typeof EvidenceSchema>[];
  verification: z.infer<typeof VerificationSchema>;
}): Tier {
  const hasAiSource = finding.source.some(isAiSource);
  const hasDeterministicEvidence = finding.evidence.some(isDeterministicEvidence);

  // An AI claim with nothing to show is never more than a prompt for a human.
  if (hasAiSource && finding.evidence.length === 0) return 'needs-review';

  if (!hasAiSource) {
    return hasDeterministicEvidence ? 'violation' : 'needs-review';
  }

  // AI is in the loop. It can reach `likely` only with an independent confirmation,
  // and it can never reach `violation` on its own say-so.
  if (finding.verification.status !== 'confirmed') return 'needs-review';
  return 'likely';
}

/**
 * Schema invariant: an AI finding carrying zero evidence is downgraded to
 * `needs-review` on parse. This is enforced here, in the contract, so that no
 * amount of prompt drift or engine bug can put an unevidenced model claim in
 * front of a user as a violation.
 *
 * `.overwrite` rather than `.transform` — the two behave identically here
 * because the shape is unchanged, but a `.transform` makes the schema's *output*
 * opaque to `z.toJSONSchema`, and the hosted API generates its OpenAPI document
 * from these contracts. An unrepresentable response schema would be documented
 * as `{}`: no error, no signal, just an API description that has quietly stopped
 * describing anything.
 */
export const FindingSchema = FindingObjectSchema.overwrite((finding) => {
  const unevidencedAiClaim = finding.source.some(isAiSource) && finding.evidence.length === 0;
  if (!unevidencedAiClaim) return finding;
  return { ...finding, tier: minTier(finding.tier, 'needs-review') };
});
