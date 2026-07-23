import type { CheckId, Degradation, Finding, ScanOptions, ScanTarget } from '@handrail/schemas';
import type { HallucinationEntry, StateCapture } from '@handrail/engine';
import { z } from 'zod';

/**
 * The graph's state channels.
 *
 * Zod, but note the deliberate `z.custom` on the heavy engine aggregates. A
 * `StateCapture` carries a whole DOM snapshot and an element index; LangGraph
 * validates state at every superstep, and re-parsing megabytes eight times per
 * page would cost more than the scan. Those payloads are already validated at
 * the boundary that produced them — the capture parses its own schema — so here
 * they are carried, not re-checked. The light fields are validated for real.
 *
 * Every channel is last-write-wins, which is correct precisely because the Phase
 * 1 graph is linear: each node owns the fields it returns. The moment the
 * crawler fans out with `Send`, the accumulating channels (`captures`,
 * `findings`, `rejected`, `degradations`) need concat reducers instead — that is
 * the change to make, and it is not a small one.
 */
export const ScanStateSchema = z.object({
  target: z.custom<ScanTarget>(),
  options: z.custom<ScanOptions>(),
  /** URLs the crawl node resolved. Phase 1 resolves exactly one. */
  urls: z.array(z.string()).prefault([]),
  captures: z.custom<StateCapture[]>().prefault([]),
  findings: z.custom<Finding[]>().prefault([]),
  /** Rejected AI candidates. Telemetry for the ledger — never findings. */
  rejected: z.custom<HallucinationEntry[]>().prefault([]),
  degradations: z.custom<Degradation[]>().prefault([]),
  /** Which checks actually ran, so the scoring layer knows what silence means. */
  checksRun: z.custom<CheckId[]>().prefault([]),
  /**
   * Every candidate the judge raised, before any stage rejected one. The
   * denominator of the hallucination ledger: "12 rejected" means nothing without
   * it, and "12 rejected of 12 raised" means something quite alarming.
   */
  candidatesSeen: z.int().nonnegative().prefault(0),
});

export type ScanState = z.infer<typeof ScanStateSchema>;
