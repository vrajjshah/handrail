import type { CheckId, Finding, ScanRecord, WcagLevel } from '@handrail/schemas';
import type { ApplicabilitySignals, KnownScId } from '@handrail/wcag';

import type { HeuristicOutcome } from '../detect/heuristics/types.js';
import type { CriterionPassEvidence } from '../detect/types.js';

/**
 * One check's run over the whole scan, normalised.
 *
 * The scoring layer needs two facts about every check that ran, and only two:
 * which criteria it speaks to, and **how many candidates it actually examined**.
 * The second is what separates "we measured 34 controls and none were too small"
 * from "there were no controls to measure" — the first is positive evidence for
 * a pass, the second proves nothing at all. Collapsing both into "no findings"
 * is exactly how a tool ends up reporting an empty page as accessible.
 */
export interface CheckRunSummary {
  checkId: CheckId;
  sc: readonly KnownScId[];
  candidatesChecked: number;
}

/** Normalises axe's clean-rule evidence into a {@link CheckRunSummary}. */
export function checkRunFromAxePass(pass: CriterionPassEvidence): CheckRunSummary {
  return { checkId: pass.checkId, sc: pass.sc, candidatesChecked: pass.nodeCount };
}

/** Normalises a heuristic's outcome into a {@link CheckRunSummary}. */
export function checkRunFromHeuristic(outcome: HeuristicOutcome): CheckRunSummary {
  return {
    checkId: outcome.checkId,
    sc: outcome.sc,
    candidatesChecked: outcome.candidatesChecked,
  };
}

/**
 * Everything the scoring layer reads.
 *
 * Deliberately not a `ScanState`: the engine sits below the orchestrator and has
 * to stay drivable from a test, a CLI or a server without any of them first
 * agreeing on what a graph is.
 */
export interface ScoreInput {
  findings: readonly Finding[];
  /** Every deterministic check that ran, with its candidate count. */
  checkRuns?: readonly CheckRunSummary[];
  /**
   * Checks the AI layers ran. Carried separately because they are recorded as
   * having run *without* a candidate count — every AI check is
   * `surfaces-candidates` class, so none of them could justify a pass anyway.
   */
  aiChecksRun?: readonly CheckId[];
  /**
   * Applicability signals derived from the captures. Omit them and every
   * criterion whose detector needs one stays `unknown`, which costs coverage
   * rather than inventing it.
   */
  signals?: ApplicabilitySignals;
  level?: WcagLevel;
}

export interface BuildReportInput extends ScoreInput {
  scan: ScanRecord;
  /** Handrail's own version, recorded in the artifact so a report is traceable. */
  toolVersion: string;
  /** Clock seam, so a golden-scan report is byte-reproducible. */
  generatedAt?: Date;
}
