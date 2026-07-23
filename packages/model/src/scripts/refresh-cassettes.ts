/**
 * Re-record the committed cassette corpus against live providers.
 *
 *   MODEL_MODE is irrelevant here — this script is always live by definition.
 *   pnpm --filter @handrail/model cassettes:refresh -- --max-usd 1.50
 *
 * Requires real credentials (`ANTHROPIC_API_KEY`, or AWS config for Bedrock).
 * Never run from CI: CI replays the committed corpus, it does not create it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';

import { DEFAULT_REFRESH_BUDGET_USD, refreshCassettes } from '../cassettes/refresh.js';
import { DEFAULT_CASSETTE_DIR, FileCassetteStore } from '../cassettes/store.js';
import { type Cassette } from '../cassettes/types.js';
import { type AnthropicMessageResponse } from '../providers/anthropic-messages.js';

function numericFlag(argv: readonly string[], name: string): number | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const maxUsd = numericFlag(argv, 'max-usd') ?? DEFAULT_REFRESH_BUDGET_USD;
  const store = new FileCassetteStore(DEFAULT_CASSETTE_DIR);

  const anthropic = new Anthropic();
  let bedrock: AnthropicBedrockMantle | undefined;

  const reissue = async (cassette: Cassette): Promise<AnthropicMessageResponse> => {
    if (cassette.key.provider === 'bedrock') {
      bedrock ??= new AnthropicBedrockMantle();
      return bedrock.messages.create(cassette.request);
    }
    if (cassette.key.provider !== 'anthropic') {
      throw new Error(`cannot refresh a ${cassette.key.provider} cassette against a live provider`);
    }
    return anthropic.messages.create(cassette.request);
  };

  const result = await refreshCassettes({
    store,
    reissue,
    maxUsd,
    log: (message) => {
      console.log(message);
    },
  });

  console.log(
    `refreshed ${String(result.refreshed)}, skipped ${String(result.skipped)}, ` +
      `spent $${result.spentUsd.toFixed(4)} of $${maxUsd.toFixed(2)}`,
  );
  if (result.stoppedForBudget) process.exitCode = 1;
}

await main();
