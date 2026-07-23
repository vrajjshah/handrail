import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { computeInputDigest } from '../digest.js';
import { ModelError } from '../errors.js';
import { DETERMINISTIC_MODEL, resolveModel } from '../models.js';
import { type ModelRequest, type ResolvedModelRequest } from '../types.js';
import {
  createDeterministicClient,
  DeterministicConfigError,
  type DeterministicResponder,
} from './deterministic.js';

function resolve<T>(request: ModelRequest<T>): ResolvedModelRequest<T> {
  return { ...request, model: resolveModel(request), inputDigest: computeInputDigest(request) };
}

function textReq(overrides: Partial<ModelRequest> = {}): ResolvedModelRequest {
  return resolve({
    role: 'text-judge',
    promptVersion: 'v1',
    messages: [{ role: 'user', content: 'hello there' }],
    ...overrides,
  });
}

describe('the local-deterministic backend', () => {
  it('reports itself as the local-deterministic provider and model', async () => {
    const client = createDeterministicClient();
    const completion = await client.complete(textReq());
    expect(client.provider).toBe('local-deterministic');
    expect(completion.model).toBe(DETERMINISTIC_MODEL);
    expect(completion.cached).toBe(false);
  });

  it('returns the same completion for the same request', async () => {
    const client = createDeterministicClient();
    const req = textReq();
    const a = await client.complete(req);
    const b = await client.complete(req);
    expect(a).toEqual(b);
  });

  it('synthesises token usage from the input and output length', async () => {
    const client = createDeterministicClient();
    const completion = await client.complete(textReq());
    expect(completion.usage.input).toBeGreaterThan(0);
    expect(completion.usage.output).toBeGreaterThan(0);
  });

  it('lets a responder script the text of the completion', async () => {
    const responders: DeterministicResponder[] = [() => ({ kind: 'respond', text: 'a clear link' })];
    const client = createDeterministicClient({ responders });
    const completion = await client.complete(textReq());
    expect(completion.text).toBe('a clear link');
  });

  it('consults responders in order and lets an earlier undefined defer to a later one', async () => {
    const responders: DeterministicResponder[] = [
      () => undefined,
      () => ({ kind: 'respond', text: 'second' }),
      () => ({ kind: 'respond', text: 'third' }),
    ];
    const client = createDeterministicClient({ responders });
    const completion = await client.complete(textReq());
    expect(completion.text).toBe('second');
  });

  it('honours a custom usage synthesiser', async () => {
    const client = createDeterministicClient({ usage: () => ({ input: 42, output: 7 }) });
    const completion = await client.complete(textReq());
    expect(completion.usage).toEqual({ input: 42, output: 7 });
  });
});

describe('the local-deterministic backend — structured outputs', () => {
  const schema = z.object({ clear: z.boolean() });

  function structuredReq(): ResolvedModelRequest<{ clear: boolean }> {
    return resolve({
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'judge this' }],
      outputSchema: schema,
    });
  }

  it('parses a responder output against the request schema', async () => {
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'respond', output: { clear: true } })],
    });
    const completion = await client.complete(structuredReq());
    expect(completion.output).toEqual({ clear: true });
  });

  it('fails as schema-invalid when the output does not parse — the native-structured-output guarantee', async () => {
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'respond', output: { clear: 'not a boolean' } })],
    });
    await expect(client.complete(structuredReq())).rejects.toMatchObject({
      name: 'ModelError',
      code: 'schema-invalid',
    });
  });

  it('is a config error, not a model error, when nothing answers a structured request', async () => {
    const client = createDeterministicClient();
    await expect(client.complete(structuredReq())).rejects.toBeInstanceOf(DeterministicConfigError);
  });

  it('is a config error when a responder omits output for a structured request', async () => {
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'respond', text: 'forgot the output' })],
    });
    await expect(client.complete(structuredReq())).rejects.toBeInstanceOf(DeterministicConfigError);
  });
});

describe('the local-deterministic backend — forced failures', () => {
  it('rejects with a typed ModelError carrying the responder-chosen code', async () => {
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'error', code: 'rate-limit', message: 'slow down' })],
    });
    const rejection = client.complete(textReq());
    await expect(rejection).rejects.toBeInstanceOf(ModelError);
    await expect(rejection).rejects.toMatchObject({ code: 'rate-limit', provider: 'local-deterministic' });
  });
});
