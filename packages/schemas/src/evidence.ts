import { z } from 'zod';

import { ArtifactIdSchema, BoundingBoxSchema, CheckIdSchema } from './primitives.js';

/**
 * Evidence is what separates Handrail from a language model with opinions.
 *
 * Every kind below is something a reader can independently check: a pixel region
 * they can look at, a DOM string they can search for, a measured number they can
 * recompute, or the raw output of a tool they can re-run.
 */

/** A screenshot or crop, optionally with the region that matters highlighted. */
export const ScreenshotEvidenceSchema = z.object({
  kind: z.literal('screenshot'),
  artifactId: ArtifactIdSchema,
  bbox: BoundingBoxSchema.optional(),
  caption: z.string().max(500).optional(),
});

/** An excerpt of the captured DOM. Must be a verbatim substring of the snapshot. */
export const DomEvidenceSchema = z.object({
  kind: z.literal('dom'),
  excerpt: z.string().min(1).max(4000),
  selector: z.string().min(1).optional(),
});

/**
 * A number Handrail computed itself from pixels — contrast ratio, target size,
 * focus-indicator delta. Vision models may *locate* the thing to measure; they
 * never produce the measurement.
 */
export const PixelEvidenceSchema = z.object({
  kind: z.literal('pixels'),
  metric: z.enum([
    'contrast-ratio',
    'target-size-px',
    'focus-indicator-delta',
    'text-image-ratio',
    'motion-delta',
  ]),
  measured: z.number().finite(),
  threshold: z.number().finite(),
  comparator: z.enum(['gte', 'lte']),
  sampleArtifactId: ArtifactIdSchema.optional(),
});

/** Raw output from a deterministic tool: axe, IBM equal-access, tsc, eslint. */
export const ToolEvidenceSchema = z.object({
  kind: z.literal('tool'),
  tool: z.enum(['axe-core', 'equal-access', 'eslint', 'typescript', 'playwright']),
  ruleId: z.string().min(1).optional(),
  output: z.string().min(1).max(8000),
});

export const EvidenceSchema = z.discriminatedUnion('kind', [
  ScreenshotEvidenceSchema,
  DomEvidenceSchema,
  PixelEvidenceSchema,
  ToolEvidenceSchema,
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Evidence that a machine produced by measurement rather than by judgment.
 *
 * The tier matrix keys off this: only deterministic evidence can raise a finding
 * to `violation`.
 */
export function isDeterministicEvidence(evidence: Evidence): boolean {
  return evidence.kind === 'pixels' || evidence.kind === 'tool';
}

/** How a finding was (or was not) independently confirmed after detection. */
export const VerificationSchema = z.object({
  method: z.enum([
    'none',
    'deterministic-recheck',
    'model-verifier',
    'deterministic-recheck+model-verifier',
  ]),
  status: z.enum(['unverified', 'confirmed', 'rejected', 'inconclusive']),
  /** Which check re-ran, when the method was a deterministic re-check. */
  recheckedBy: CheckIdSchema.optional(),
  note: z.string().max(1000).optional(),
});
export type Verification = z.infer<typeof VerificationSchema>;
