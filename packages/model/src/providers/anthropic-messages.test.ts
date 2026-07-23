import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';

import { capabilityFor } from '../capability.js';
import { computeInputDigest } from '../digest.js';
import { ModelError } from '../errors.js';
import { HAIKU_4_5, resolveModel, SONNET_5 } from '../models.js';
import { type ModelRequest, type ResolvedModelRequest } from '../types.js';
import {
  type AnthropicMessageResponse,
  buildCreateParams,
  DEFAULT_MAX_TOKENS,
  mapCompletion,
  mapProviderError,
} from './anthropic-messages.js';

function resolve<T>(request: ModelRequest<T>): ResolvedModelRequest<T> {
  return { ...request, model: resolveModel(request), inputDigest: computeInputDigest(request) };
}

/** The `ModelError.code` a synchronous call throws, or a marker when it doesn't. */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof ModelError ? error.code : `not-a-model-error: ${String(error)}`;
  }
  return 'did-not-throw';
}

function textResponse(overrides: Partial<AnthropicMessageResponse> = {}): AnthropicMessageResponse {
  return {
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'a clear link' }],
    usage: { input_tokens: 12, output_tokens: 4 },
    ...overrides,
  };
}

describe('buildCreateParams — the ADR-0004 constraints, as data', () => {
  it('sets adaptive thinking explicitly on Sonnet 5 and never a sampling knob', () => {
    const request = resolve({
      role: 'vision-judge',
      promptVersion: 'v1',
      system: 'the rubric',
      messages: [{ role: 'user', content: 'judge this' }],
    });
    const params = buildCreateParams(request, capabilityFor('anthropic', request.model), request.model);

    expect(params.model).toBe(SONNET_5);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
    expect('temperature' in params).toBe(false);
    expect('top_p' in params).toBe(false);
    expect('top_k' in params).toBe(false);
  });

  it('omits thinking entirely for Haiku 4.5, which has no adaptive mode', () => {
    const request = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'judge this' }],
    });
    const params = buildCreateParams(request, capabilityFor('anthropic', request.model), request.model);

    expect(params.model).toBe(HAIKU_4_5);
    expect(params.thinking).toBeUndefined();
  });

  it('marks the system prefix with a cache breakpoint', () => {
    const request = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      system: 'stable prefix',
      messages: [{ role: 'user', content: 'x' }],
    });
    const params = buildCreateParams(request, capabilityFor('anthropic', request.model), request.model);

    expect(params.system).toEqual([
      { type: 'text', text: 'stable prefix', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('defaults max_tokens and lets the request override it', () => {
    const base = { role: 'text-judge' as const, promptVersion: 'v1', messages: [{ role: 'user' as const, content: 'x' }] };
    const dflt = buildCreateParams(resolve(base), capabilityFor('anthropic', HAIKU_4_5), HAIKU_4_5);
    const capped = buildCreateParams(resolve({ ...base, maxOutputTokens: 512 }), capabilityFor('anthropic', HAIKU_4_5), HAIKU_4_5);

    expect(dflt.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(capped.max_tokens).toBe(512);
  });

  it('attaches a structured-output format only when the request carries a schema', () => {
    const schema = z.object({ ok: z.boolean() });
    const withSchema = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: schema,
    });
    const withoutSchema = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(
      buildCreateParams(withSchema, capabilityFor('anthropic', HAIKU_4_5), HAIKU_4_5).output_config
        ?.format,
    ).toBeDefined();
    expect(
      buildCreateParams(withoutSchema, capabilityFor('anthropic', HAIKU_4_5), HAIKU_4_5)
        .output_config,
    ).toBeUndefined();
  });
});

describe('mapCompletion', () => {
  const textRequest = resolve({
    role: 'text-judge',
    promptVersion: 'v1',
    messages: [{ role: 'user', content: 'x' }],
  });

  it('returns the joined text and mapped usage for an unstructured response', () => {
    const completion = mapCompletion(textRequest, textResponse(), 'anthropic');
    expect(completion.text).toBe('a clear link');
    expect(completion.output).toBe('a clear link');
    expect(completion.model).toBe(HAIKU_4_5); // the canonical id, not the wire id
    expect(completion.usage).toEqual({ input: 12, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect(completion.cached).toBe(false);
  });

  it('maps cache usage and flags cached when a prefix was read', () => {
    const completion = mapCompletion(
      textRequest,
      textResponse({
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          cache_read_input_tokens: 4096,
          cache_creation_input_tokens: 0,
        },
      }),
      'anthropic',
    );
    expect(completion.usage.cacheRead).toBe(4096);
    expect(completion.cached).toBe(true);
  });

  it('coalesces null cache token counts to zero', () => {
    const completion = mapCompletion(
      textRequest,
      textResponse({
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }),
      'anthropic',
    );
    expect(completion.usage.cacheRead).toBe(0);
    expect(completion.usage.cacheWrite).toBe(0);
  });

  it('parses structured output against the request schema', () => {
    const schema = z.object({ clear: z.boolean() });
    const request = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: schema,
    });
    const completion = mapCompletion(
      request,
      textResponse({ content: [{ type: 'text', text: JSON.stringify({ clear: true }) }] }),
      'anthropic',
    );
    expect(completion.output).toEqual({ clear: true });
  });

  it('fails as schema-invalid when structured output is not valid JSON', () => {
    const schema = z.object({ clear: z.boolean() });
    const request = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: schema,
    });
    expect(
      thrownCode(() =>
        mapCompletion(request, textResponse({ content: [{ type: 'text', text: 'not json' }] }), 'anthropic'),
      ),
    ).toBe('schema-invalid');
  });

  it('fails as schema-invalid when the JSON does not match the schema', () => {
    const schema = z.object({ clear: z.boolean() });
    const request = resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: schema,
    });
    expect(
      thrownCode(() =>
        mapCompletion(
          request,
          textResponse({ content: [{ type: 'text', text: JSON.stringify({ clear: 'no' }) }] }),
          'anthropic',
        ),
      ),
    ).toBe('schema-invalid');
  });

  it('turns a refusal stop reason into a content-filter error, not silent output', () => {
    expect(
      thrownCode(() =>
        mapCompletion(textRequest, textResponse({ stop_reason: 'refusal', content: [] }), 'anthropic'),
      ),
    ).toBe('content-filter');
  });
});

describe('mapProviderError', () => {
  it('maps SDK HTTP statuses to typed codes', () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [403, 'auth'],
      [408, 'timeout'],
      [413, 'context-length'],
      [429, 'rate-limit'],
      [529, 'overloaded'],
      [500, 'provider-error'],
      [400, 'provider-error'],
    ];
    for (const [status, code] of cases) {
      const sdkError = APIError.generate(status, undefined, `status ${status}`, new Headers());
      expect(mapProviderError(sdkError, 'anthropic').code).toBe(code);
    }
  });

  it('maps connection failures to network and timeout', () => {
    expect(mapProviderError(new APIConnectionError({ message: 'down' }), 'anthropic').code).toBe(
      'network',
    );
    expect(
      mapProviderError(new APIConnectionTimeoutError({ message: 'slow' }), 'anthropic').code,
    ).toBe('timeout');
  });

  it('records the originating provider and preserves the cause', () => {
    const sdkError = APIError.generate(429, undefined, 'slow down', new Headers());
    const mapped = mapProviderError(sdkError, 'bedrock');
    expect(mapped.provider).toBe('bedrock');
    expect(mapped.cause).toBe(sdkError);
  });

  it('passes an existing ModelError through untouched', () => {
    const original = new ModelError('schema-invalid', 'bad json');
    expect(mapProviderError(original, 'anthropic')).toBe(original);
  });

  it('wraps an unknown non-error throw as a provider-error', () => {
    expect(mapProviderError('weird', 'anthropic').code).toBe('provider-error');
  });
});
