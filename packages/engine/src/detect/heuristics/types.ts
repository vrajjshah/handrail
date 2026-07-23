import type { CheckId, Finding } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { DetectionDegradation } from '../types.js';

/**
 * The outcome of one heuristic over one captured state.
 *
 * `candidatesChecked` and `violations` are what let the scoring layer decide
 * whether a criterion earned a `pass`. A `decides`-class check that examined
 * candidates and found no failures is positive evidence; a check that found no
 * candidates to examine proves nothing. Carrying both counts keeps that judgment
 * where it belongs — in scoring — rather than pre-deciding it here.
 */
export interface HeuristicOutcome {
  checkId: CheckId;
  sc: readonly KnownScId[];
  findings: Finding[];
  candidatesChecked: number;
}

export interface HeuristicResult {
  outcomes: HeuristicOutcome[];
  degradations: DetectionDegradation[];
}

/** Every finding across every heuristic, flattened. */
export function allFindings(result: HeuristicResult): Finding[] {
  return result.outcomes.flatMap((outcome) => outcome.findings);
}
