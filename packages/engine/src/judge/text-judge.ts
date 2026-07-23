import type { CostLedger, ModelClient } from '@handrail/model';
import type { ModelInvocation } from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';
import { buildElementExtract, type ElementExtract } from './element-extract.js';
import {
  TEXT_JUDGE_PROMPT_VERSION,
  TEXT_JUDGE_SYSTEM,
  renderTextJudgeUser,
} from './prompts.js';
import { TextJudgeOutputSchema, type TextJudgeCandidate } from './text-judge-schema.js';

export interface TextJudgeDeps {
  /** Every model call goes through the ledger — it is the seam, not a wrapper. */
  ledger: CostLedger;
  client: ModelClient;
}

export interface TextJudgeOptions {
  /** Token ceiling for the element payload. */
  maxExtractTokens?: number;
  /** Caps thinking and response together; the plan budgets 1.5K output per state. */
  maxOutputTokens?: number;
}

export interface TextJudgeResult {
  candidates: TextJudgeCandidate[];
  extract: ElementExtract;
  invocation: ModelInvocation;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1500;

/**
 * The batched text judge: **one** model call per captured state.
 *
 * One call, not nine. The nine claim families read overlapping slices of the
 * same element list, so asking them separately would re-send the page nine times
 * — nine times the input tokens for strictly less context, since a link's
 * purpose often depends on the heading above it. Batching is what makes the text
 * layer affordable enough to run on every page of every scan.
 *
 * The call is structured-output only: `TextJudgeOutputSchema` is enforced by the
 * provider natively, so a reply that is not schema-valid is a `ModelError`
 * rather than something this function has to defend against.
 *
 * Nothing here decides anything. Every candidate returned is unverified and
 * ungrounded — it is the verdict pipeline that turns some of them into findings
 * and the rest into hallucination-ledger rows.
 */
export async function runTextJudge(
  deps: TextJudgeDeps,
  capture: StateCapture,
  options: TextJudgeOptions = {},
): Promise<TextJudgeResult> {
  const extract = buildElementExtract(
    capture,
    options.maxExtractTokens === undefined ? {} : { maxTokens: options.maxExtractTokens },
  );

  const result = await deps.ledger.invoke(deps.client, {
    role: 'text-judge',
    promptVersion: TEXT_JUDGE_PROMPT_VERSION,
    system: TEXT_JUDGE_SYSTEM,
    messages: [{ role: 'user', content: renderTextJudgeUser(extract) }],
    outputSchema: TextJudgeOutputSchema,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return { candidates: result.output.candidates, extract, invocation: result.invocation };
}
