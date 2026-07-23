import { TokenUsageSchema } from '@handrail/schemas';

import { computeCostUsd } from '../pricing.js';
import { type AnthropicMessageResponse } from '../providers/anthropic-messages.js';
import { type Cassette, type CassetteStore } from './types.js';

/** Default spend ceiling for a refresh run. Re-recording must never be a surprise bill. */
export const DEFAULT_REFRESH_BUDGET_USD = 2;

export interface RefreshOptions {
  store: CassetteStore;
  /** Re-issue a cassette's stored request against a live provider. */
  reissue: (cassette: Cassette) => Promise<AnthropicMessageResponse>;
  maxUsd?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface RefreshResult {
  refreshed: number;
  skipped: number;
  spentUsd: number;
  stoppedForBudget: boolean;
}

/**
 * Re-record every committed cassette by replaying its stored *request* against a
 * live provider and overwriting the response. Because the request was captured
 * verbatim, a refresh reproduces the original call exactly rather than
 * approximating it — so a diff in the committed corpus is a real change in model
 * behaviour, which is precisely what this layer exists to catch.
 *
 * The budget is checked *before* each call, so the cap is never exceeded by the
 * call that would breach it.
 */
export async function refreshCassettes(options: RefreshOptions): Promise<RefreshResult> {
  const maxUsd = options.maxUsd ?? DEFAULT_REFRESH_BUDGET_USD;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);

  const cassettes = await options.store.list();
  const result: RefreshResult = { refreshed: 0, skipped: 0, spentUsd: 0, stoppedForBudget: false };

  for (const cassette of cassettes) {
    if (result.spentUsd >= maxUsd) {
      result.stoppedForBudget = true;
      result.skipped += 1;
      continue;
    }

    const response = await options.reissue(cassette);
    const usage = TokenUsageSchema.parse({
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    });
    const at = now();
    result.spentUsd += computeCostUsd({
      provider: cassette.key.provider,
      model: cassette.key.model,
      usage,
      at,
    });

    await options.store.write({ ...cassette, recordedAt: at.toISOString(), response });
    result.refreshed += 1;
    log(`re-recorded ${cassette.key.role}/${cassette.key.promptVersion}`);
  }

  if (result.stoppedForBudget) {
    log(`stopped after $${result.spentUsd.toFixed(4)} — budget cap $${maxUsd.toFixed(2)} reached`);
  }
  return result;
}
