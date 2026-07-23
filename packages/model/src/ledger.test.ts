import { ModelErrorCodeSchema } from '@handrail/schemas';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { computeInputDigest } from './digest.js';
import { ModelError } from './errors.js';
import { DETERMINISTIC_MODEL } from './models.js';
import { createDeterministicClient } from './providers/deterministic.js';
import { lastOf, testLedger, textRequest } from './__test__/helpers.js';

describe('CostLedger.invoke — a successful call', () => {
  it('records one schema-valid invocation with cost and latency', async () => {
    const ledger = testLedger();
    const client = createDeterministicClient();
    const request = textRequest();

    const result = await ledger.invoke(client, request);

    expect(ledger.invocations).toHaveLength(1);
    const invocation = lastOf(ledger.invocations);
    expect(invocation).toBe(result.invocation);
    expect(invocation.ok).toBe(true);
    expect(invocation.provider).toBe('local-deterministic');
    expect(invocation.model).toBe(DETERMINISTIC_MODEL);
    expect(invocation.role).toBe('text-judge');
    expect(invocation.promptVersion).toBe('v1');
    expect(invocation.inputDigest).toBe(computeInputDigest(request));
    expect(invocation.costUsd).toBe(0);
    expect(invocation.latencyMs).toBe(5);
    expect(invocation.errorCode).toBeUndefined();
    expect(invocation.startedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('returns the completion text when the request has no schema', async () => {
    const ledger = testLedger();
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'respond', text: 'the link purpose is clear' })],
    });

    const result = await ledger.invoke(client, textRequest());
    expect(result.output).toBe('the link purpose is clear');
    expect(result.text).toBe('the link purpose is clear');
  });

  it('returns parsed structured output when the request carries a schema', async () => {
    const schema = z.object({ clear: z.boolean() });
    const ledger = testLedger();
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'respond', output: { clear: false } })],
    });

    const result = await ledger.invoke(client, {
      role: 'text-judge',
      promptVersion: 'v1',
      messages: [{ role: 'user', content: 'judge' }],
      outputSchema: schema,
    });

    expect(result.output).toEqual({ clear: false });
  });

  it('notifies the onInvocation subscriber for the orchestrator to emit an event', async () => {
    const onInvocation = vi.fn();
    const ledger = testLedger({ onInvocation });
    await ledger.invoke(createDeterministicClient(), textRequest());
    expect(onInvocation).toHaveBeenCalledTimes(1);
    expect(onInvocation).toHaveBeenCalledWith(lastOf(ledger.invocations));
  });

  it('accumulates cost and usage across calls', async () => {
    const ledger = testLedger();
    const client = createDeterministicClient({ usage: () => ({ input: 100, output: 20 }) });
    await ledger.invoke(client, textRequest());
    await ledger.invoke(client, textRequest({ promptVersion: 'v2' }));

    expect(ledger.invocations).toHaveLength(2);
    expect(ledger.totalCostUsd).toBe(0);
    expect(ledger.totalUsage).toEqual({ input: 200, output: 40, cacheRead: 0, cacheWrite: 0 });
  });

  it('defaults the correlation id to the scan id', async () => {
    const ledger = testLedger();
    await ledger.invoke(createDeterministicClient(), textRequest());
    expect(lastOf(ledger.invocations).correlationId).toBe('scan_test');
  });
});

describe('CostLedger.invoke — a failed call', () => {
  it('records the failure and re-throws a typed error — never falls back to a result', async () => {
    const ledger = testLedger();
    const client = createDeterministicClient({
      responders: [() => ({ kind: 'error', code: 'overloaded', message: 'busy' })],
    });

    // The crux of trust invariant 1: the promise rejects. There is no code path
    // that resolves with a deterministic stand-in for the answer we could not get.
    await expect(ledger.invoke(client, textRequest())).rejects.toBeInstanceOf(ModelError);

    expect(ledger.invocations).toHaveLength(1);
    const invocation = lastOf(ledger.invocations);
    expect(invocation.ok).toBe(false);
    expect(invocation.errorCode).toBe('overloaded');
    expect(invocation.errorMessage).toBe('busy');
    expect(invocation.costUsd).toBe(0);
    expect(invocation.latencyMs).toBe(5);
    expect(invocation.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('records an invocation and rejects with the right code for every ModelErrorCode', async () => {
    for (const code of ModelErrorCodeSchema.options) {
      const ledger = testLedger();
      const client = createDeterministicClient({ responders: [() => ({ kind: 'error', code })] });

      await expect(ledger.invoke(client, textRequest())).rejects.toMatchObject({
        name: 'ModelError',
        code,
      });

      const invocation = lastOf(ledger.invocations);
      expect(invocation.ok).toBe(false);
      expect(invocation.errorCode).toBe(code);
      expect(invocation.costUsd).toBe(0);
      expect(invocation.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
