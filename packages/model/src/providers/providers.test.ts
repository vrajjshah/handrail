import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HAIKU_4_5 } from '../models.js';
import { type ModelRequest } from '../types.js';
import { lastOf, testLedger, textRequest } from '../__test__/helpers.js';
import {
  type AnthropicMessageResponse,
  type MessagesTransport,
} from './anthropic-messages.js';
import { createAnthropicClient } from './anthropic.js';
import { BEDROCK_MODEL_PREFIX, createBedrockClient, toBedrockModelId } from './bedrock.js';

interface RecordingTransport {
  transport: MessagesTransport;
  models: string[];
}

/** A transport that always returns the same canned response and records the model it saw. */
function recordingTransport(response: AnthropicMessageResponse): RecordingTransport {
  const models: string[] = [];
  const transport: MessagesTransport = (params) => {
    models.push(params.model);
    return Promise.resolve(response);
  };
  return { transport, models };
}

describe('toBedrockModelId', () => {
  it('prefixes a canonical id and is idempotent', () => {
    expect(toBedrockModelId(HAIKU_4_5)).toBe(`${BEDROCK_MODEL_PREFIX}${HAIKU_4_5}`);
    expect(toBedrockModelId(`${BEDROCK_MODEL_PREFIX}${HAIKU_4_5}`)).toBe(
      `${BEDROCK_MODEL_PREFIX}${HAIKU_4_5}`,
    );
  });
});

describe('the same prompt runs against both providers and returns schema-valid output', () => {
  it('returns identical parsed output while sending provider-specific model ids', async () => {
    const schema = z.object({ clear: z.boolean() });
    const response: AnthropicMessageResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ clear: true }) }],
      usage: { input_tokens: 20, output_tokens: 5 },
    };
    const request: ModelRequest<{ clear: boolean }> = {
      role: 'text-judge',
      promptVersion: 'v1',
      system: 'is the link purpose clear?',
      messages: [{ role: 'user', content: 'Read more' }],
      outputSchema: schema,
    };

    const anthropic = recordingTransport(response);
    const bedrock = recordingTransport(response);
    const ledger = testLedger();

    const fromAnthropic = await ledger.invoke(createAnthropicClient({ transport: anthropic.transport }), request);
    const fromBedrock = await ledger.invoke(createBedrockClient({ transport: bedrock.transport }), request);

    // Same schema-valid output from both providers.
    expect(fromAnthropic.output).toEqual({ clear: true });
    expect(fromBedrock.output).toEqual({ clear: true });

    // Anthropic sends the canonical id; Bedrock sends the `anthropic.`-prefixed id.
    expect(anthropic.models).toEqual([HAIKU_4_5]);
    expect(bedrock.models).toEqual([`${BEDROCK_MODEL_PREFIX}${HAIKU_4_5}`]);

    // Both invocations are recorded against the canonical model, so cost is
    // computed the same way regardless of provider.
    expect(ledger.invocations[0]?.model).toBe(HAIKU_4_5);
    expect(ledger.invocations[1]?.model).toBe(HAIKU_4_5);
    expect(ledger.invocations[1]?.provider).toBe('bedrock');
  });
});

describe('cached-prefix reuse is visible in the cost ledger', () => {
  /**
   * A transport that models Anthropic's prompt cache: the first time it sees a
   * system prefix it bills the tokens as a cache *write*; an identical prefix on
   * the next call bills them as a cache *read* instead.
   */
  function cachingTransport(prefixTokens: number): MessagesTransport {
    const seen = new Set<string>();
    return (params) => {
      const prefix = JSON.stringify(params.system ?? null);
      const firstSeen = !seen.has(prefix);
      seen.add(prefix);
      return Promise.resolve({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          cache_creation_input_tokens: firstSeen ? prefixTokens : 0,
          cache_read_input_tokens: firstSeen ? 0 : prefixTokens,
        },
      });
    };
  }

  it('bills the second identical-prefix call as a cheaper cache read', async () => {
    const ledger = testLedger();
    const client = createAnthropicClient({ transport: cachingTransport(5000) });
    const request = textRequest({ system: 'system prompt + WCAG reference' });

    await ledger.invoke(client, request);
    await ledger.invoke(client, request);

    const [first, second] = ledger.invocations;
    expect(first?.usage.cacheWrite).toBe(5000);
    expect(first?.usage.cacheRead).toBe(0);
    expect(second?.usage.cacheRead).toBe(5000);
    expect(second?.usage.cacheWrite).toBe(0);

    // The reused prefix is the whole point: the second call costs less.
    expect(second?.costUsd).toBeLessThan(first?.costUsd ?? 0);
    expect(lastOf(ledger.invocations).cached).toBe(true);
  });
});
