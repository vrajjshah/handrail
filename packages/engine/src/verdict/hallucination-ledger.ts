import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { IsoTimestampSchema, PageStateIdSchema, ScanIdSchema } from '@handrail/schemas';
import { z } from 'zod';

import { REJECTION_REASONS } from './grounding.js';
import { CLAIM_FAMILIES } from '../judge/types.js';

/** Which stage of the pipeline turned the candidate away. */
export const REJECTION_STAGES = ['grounding', 'recheck', 'verification'] as const;
export type RejectionStage = (typeof REJECTION_STAGES)[number];

export const HallucinationEntrySchema = z.object({
  pageStateId: PageStateIdSchema,
  url: z.url(),
  family: z.enum(CLAIM_FAMILIES),
  checkId: z.string().min(1),
  /** The id the model named — kept verbatim, including when no such element exists. */
  claimedElemId: z.string().min(1).max(64),
  stage: z.enum(REJECTION_STAGES),
  reason: z.enum(REJECTION_REASONS),
  detail: z.string().min(1).max(1000),
  /** The model's own confidence, so the ledger can show whether it was confidently wrong. */
  confidence: z.number().min(0).max(1),
  /** The claim as asserted. Truncated; this is telemetry, not a report. */
  claim: z.string().max(600),
});
export type HallucinationEntry = z.infer<typeof HallucinationEntrySchema>;

export const HallucinationLedgerSchema = z.object({
  version: z.literal(1),
  scanId: ScanIdSchema,
  generatedAt: IsoTimestampSchema,
  counts: z.object({
    candidates: z.int().nonnegative(),
    rejected: z.int().nonnegative(),
    byReason: z.record(z.string(), z.int().nonnegative()),
    byStage: z.record(z.string(), z.int().nonnegative()),
  }),
  entries: z.array(HallucinationEntrySchema),
});
export type HallucinationLedger = z.infer<typeof HallucinationLedgerSchema>;

export const HALLUCINATION_LEDGER_FILENAME = 'hallucination-ledger.json';

export interface BuildLedgerInput {
  scanId: string;
  /** Every candidate the judge produced, across every state. */
  candidatesSeen: number;
  entries: readonly HallucinationEntry[];
  generatedAt?: Date;
}

/**
 * Build the hallucination ledger.
 *
 * This file is the honest half of the trust story. The report says "here is what
 * we found"; the ledger says "here is what the model claimed and we threw away,
 * and why". Publishing the second is what makes the first checkable — a
 * rejection rate that climbs after a prompt change is visible here and nowhere
 * else, and the plan's `candidate-rejection rate` metric is computed from it.
 *
 * It is **telemetry only**. Nothing in it is a finding, nothing in it reaches
 * `report.json`, and the pipeline has no path that promotes an entry back.
 */
export function buildHallucinationLedger(input: BuildLedgerInput): HallucinationLedger {
  const byReason: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  for (const entry of input.entries) {
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
  }

  return HallucinationLedgerSchema.parse({
    version: 1,
    scanId: input.scanId,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    counts: {
      candidates: input.candidatesSeen,
      rejected: input.entries.length,
      byReason,
      byStage,
    },
    entries: input.entries,
  });
}

/** Writes the ledger next to the rest of a scan's artifacts. Returns the path written. */
export async function writeHallucinationLedger(
  directory: string,
  ledger: HallucinationLedger,
): Promise<string> {
  const path = join(directory, HALLUCINATION_LEDGER_FILENAME);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  return path;
}
