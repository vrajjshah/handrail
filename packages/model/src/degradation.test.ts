import { isDegraded, ModelErrorCodeSchema, ScanRecordSchema } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { degradationForModelError } from './degradation.js';
import { ModelError } from './errors.js';
import { createDeterministicClient } from './providers/deterministic.js';
import { testLedger, textRequest } from './__test__/helpers.js';

describe('degradationForModelError', () => {
  it('maps a blown budget to budget-exhausted', () => {
    const degradation = degradationForModelError(new ModelError('budget-exceeded'));
    expect(degradation.reason).toBe('budget-exhausted');
  });

  it('maps every other failure to model-unavailable', () => {
    for (const code of ModelErrorCodeSchema.options) {
      if (code === 'budget-exceeded') continue;
      expect(degradationForModelError(new ModelError(code)).reason).toBe('model-unavailable');
    }
  });

  it('names the provider and code in the detail so the report can say what went wrong', () => {
    const degradation = degradationForModelError(
      new ModelError('auth', 'bad api key', { provider: 'anthropic' }),
      { phase: 'judge-text' },
    );
    expect(degradation.detail).toContain('anthropic');
    expect(degradation.detail).toContain('auth');
    expect(degradation.detail).toContain('bad api key');
    expect(degradation.phase).toBe('judge-text');
  });
});

describe('a forced provider outage produces a degraded scan that says so', () => {
  it('turns a rejected invocation into a degradation the ScanRecord reports', async () => {
    const ledger = testLedger();
    const outage = createDeterministicClient({
      responders: [() => ({ kind: 'error', code: 'overloaded', message: 'provider down' })],
    });

    // 1. The call fails loudly rather than falling back.
    let caught: unknown;
    try {
      await ledger.invoke(outage, textRequest());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelError);

    // 2. The failure becomes a scan-level degradation...
    const degradation = degradationForModelError(caught as ModelError, { phase: 'judge-text' });

    // 3. ...and a scan carrying it is, by the schema's own predicate, degraded.
    const scan = ScanRecordSchema.parse({
      id: 'scan_test',
      target: { kind: 'url', url: 'https://example.com/' },
      options: {},
      status: 'completed',
      createdAt: '2026-07-23T10:00:00.000Z',
      degradations: [degradation],
    });

    expect(isDegraded(scan)).toBe(true);
    expect(scan.degradations[0]?.reason).toBe('model-unavailable');
    // The recorded invocation still exists as the audit trail for the failure.
    expect(ledger.invocations).toHaveLength(1);
    expect(ledger.invocations[0]?.ok).toBe(false);
  });
});
