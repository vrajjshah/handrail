import { z } from 'zod';

import { CostUsdSchema, IsoTimestampSchema, ScanIdSchema } from './primitives.js';
import { ScanOptionsSchema, ScanTargetSchema } from './target.js';

/** Ordered pipeline stages. Also the vocabulary of the live progress timeline. */
export const ScanPhaseSchema = z.enum([
  'queued',
  'crawl',
  'capture',
  'detect',
  'judge-text',
  'judge-vision',
  'verdict',
  'site',
  'score',
  'report',
  'fix',
]);
export type ScanPhase = z.infer<typeof ScanPhaseSchema>;

export const ScanStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

/**
 * Why a scan delivered less than it set out to.
 *
 * Recording these is the whole point of trust invariant 1: there is no silent
 * fallback path. If the model was unreachable, the report says the model was
 * unreachable — it does not quietly ship deterministic-only results as if that
 * were what the user asked for.
 */
export const DegradationSchema = z.object({
  reason: z.enum([
    'model-unavailable',
    'budget-exhausted',
    'time-exhausted',
    'vision-disabled',
    'page-unreachable',
    'bot-protection',
    'auth-failed',
    'crawl-truncated',
  ]),
  detail: z.string().min(1).max(2000),
  phase: ScanPhaseSchema.optional(),
  at: IsoTimestampSchema,
});
export type Degradation = z.infer<typeof DegradationSchema>;

export const ScanCountsSchema = z.object({
  pagesDiscovered: z.int().nonnegative().default(0),
  pagesCaptured: z.int().nonnegative().default(0),
  statesCaptured: z.int().nonnegative().default(0),
  findingsTotal: z.int().nonnegative().default(0),
  findingsViolation: z.int().nonnegative().default(0),
  findingsLikely: z.int().nonnegative().default(0),
  findingsNeedsReview: z.int().nonnegative().default(0),
  /** AI candidates rejected by grounding or the verifier. Telemetry, never shown as findings. */
  candidatesRejected: z.int().nonnegative().default(0),
});
export type ScanCounts = z.infer<typeof ScanCountsSchema>;

export const ScanRecordSchema = z.object({
  id: ScanIdSchema,
  target: ScanTargetSchema,
  options: ScanOptionsSchema,
  status: ScanStatusSchema,
  phase: ScanPhaseSchema.default('queued'),
  counts: ScanCountsSchema.prefault({}),
  costUsd: CostUsdSchema.default(0),
  degradations: z.array(DegradationSchema).default([]),
  createdAt: IsoTimestampSchema,
  startedAt: IsoTimestampSchema.optional(),
  finishedAt: IsoTimestampSchema.optional(),
  /** Set only when `status` is `failed`. */
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1).max(4000),
    })
    .optional(),
});
export type ScanRecord = z.infer<typeof ScanRecordSchema>;
export type ScanRecordInput = z.input<typeof ScanRecordSchema>;

/** A scan is degraded when it completed but could not do everything it was asked to. */
export function isDegraded(scan: ScanRecord): boolean {
  return scan.degradations.length > 0;
}
