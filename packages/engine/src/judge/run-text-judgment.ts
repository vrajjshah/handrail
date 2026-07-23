import type { CostLedger, ModelClient } from '@handrail/model';
import type { CheckId } from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';
import {
  runVerdictPipeline,
  type VerdictOptions,
  type VerdictResult,
} from '../verdict/pipeline.js';
import type { ElementExtract } from './element-extract.js';
import { runTextJudge, type TextJudgeOptions } from './text-judge.js';
import { CLAIM_FAMILIES, CLAIM_FAMILY_SPECS } from './types.js';

export interface TextJudgmentDeps {
  ledger: CostLedger;
  /** The judge's client. */
  client: ModelClient;
  /** The verifier's client. Defaults to the judge's, but a different one is better. */
  verifierClient?: ModelClient;
}

export type TextJudgmentOptions = TextJudgeOptions & VerdictOptions;

export interface TextJudgmentResult extends VerdictResult {
  extract: ElementExtract;
  /** Which checks this layer *ran*, so the scoring layer knows what silence means. */
  checksRun: readonly CheckId[];
}

const CHECKS_RUN: readonly CheckId[] = CLAIM_FAMILIES.map(
  (family) => CLAIM_FAMILY_SPECS[family].checkId,
);

/**
 * Detection layer C, end to end: one batched judgment call over a captured
 * state, then the verdict pipeline over everything it claimed.
 *
 * The composition is deliberate. `runTextJudge` on its own returns *candidates*,
 * and a candidate is not a finding — it is an assertion with no standing. There
 * is no exported path that turns judge output into findings without going
 * through `runVerdictPipeline`, because the moment such a path exists somebody
 * will use it in a hurry and the hallucination rate stops being structural.
 */
export async function runTextJudgment(
  deps: TextJudgmentDeps,
  capture: StateCapture,
  options: TextJudgmentOptions = {},
): Promise<TextJudgmentResult> {
  const judged = await runTextJudge({ ledger: deps.ledger, client: deps.client }, capture, options);

  const verdict = await runVerdictPipeline(
    judged.candidates,
    capture,
    { ledger: deps.ledger, verifierClient: deps.verifierClient ?? deps.client },
    options,
  );

  const degradations = [...verdict.degradations];
  if (judged.extract.truncated) {
    degradations.push({
      reason: 'extract-truncated',
      detail:
        `${String(judged.extract.omittedElements)} of ${String(judged.extract.relevantElements)} ` +
        `relevant elements were omitted from the text-judge extract to stay inside the token budget`,
    });
  }

  return { ...verdict, degradations, extract: judged.extract, checksRun: CHECKS_RUN };
}
