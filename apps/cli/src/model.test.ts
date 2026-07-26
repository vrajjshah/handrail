import { CostLedger, ModelError, createDeterministicClient } from '@handrail/model';
import { scanId } from '@handrail/schemas';
import { describe, expect, it, vi } from 'vitest';

import { UsageError } from './args.js';
import { createModelSetup, withBudget, type CreateClientOptions } from './model.js';

const id = scanId('scan_model_test');

describe('deterministic mode is $0 by construction', () => {
  it('constructs no client at all — the factory is never called', () => {
    const createClient = vi.fn();
    const setup = createModelSetup({ mode: 'deterministic', scanId: id, createClient, env: {} });

    expect(setup.model).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(setup.notes.join(' ')).toContain('$0');
  });

  it('does not even look for credentials', () => {
    // No ANTHROPIC_API_KEY, no MODEL_MODE: a deterministic scan is unaffected.
    expect(() => createModelSetup({ mode: 'deterministic', scanId: id, env: {} })).not.toThrow();
  });
});

describe('hybrid mode', () => {
  // Takes the options explicitly so a spy records them: the provider the CLI
  // chose is the thing these tests are actually about.
  const createClient = (_options: CreateClientOptions) =>
    createDeterministicClient({ responders: [] });

  it('refuses to start without credentials rather than silently going deterministic', () => {
    expect(() =>
      createModelSetup({ mode: 'hybrid', scanId: id, env: {}, createClient }),
    ).toThrow(UsageError);
    expect(() => createModelSetup({ mode: 'hybrid', scanId: id, env: {}, createClient })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('needs no key in replay mode — that is the point of the cassette corpus', () => {
    const setup = createModelSetup({
      mode: 'hybrid',
      scanId: id,
      env: { MODEL_MODE: 'replay' },
      createClient,
    });
    expect(setup.model).toBeDefined();
    expect(setup.notes.join(' ')).toContain('MODEL_MODE=replay');
  });

  it('gives the verifier its own client, because independence is the point', () => {
    const factory = vi.fn(createClient);
    createModelSetup({
      mode: 'hybrid',
      scanId: id,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      createClient: factory,
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('routes to bedrock when asked, without needing an Anthropic key', () => {
    const factory = vi.fn(createClient);
    const setup = createModelSetup({
      mode: 'hybrid',
      scanId: id,
      env: { HANDRAIL_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' },
      createClient: factory,
    });
    expect(factory.mock.calls[0]?.[0].provider).toBe('bedrock');
    expect(setup.notes.join(' ')).toContain('bedrock');
  });

  it('says out loud that vision is not implemented yet rather than pretending', () => {
    const setup = createModelSetup({
      mode: 'hybrid-vision',
      scanId: id,
      env: { MODEL_MODE: 'replay' },
      createClient,
    });
    expect(setup.notes.join(' ')).toContain('vision judgment is not implemented yet');
  });
});

describe('the budget cap', () => {
  it('refuses the call before spending, not after', async () => {
    const ledger = new CostLedger({ scanId: id });
    const inner = createDeterministicClient({
      responders: [() => ({ kind: 'respond', text: 'ok' })],
    });

    // A ledger at $0 is under any budget, so the call goes through.
    const allowed = withBudget(inner, ledger, 1);
    await expect(
      allowed.complete({ role: 'text-judge', promptVersion: 'v1', messages: [], model: 'x', inputDigest: 'd' }),
    ).resolves.toBeDefined();

    // A budget of zero stops the very first call.
    const blocked = withBudget(inner, ledger, 0);
    await expect(
      blocked.complete({ role: 'text-judge', promptVersion: 'v1', messages: [], model: 'x', inputDigest: 'd' }),
    ).rejects.toBeInstanceOf(ModelError);
  });

  it('throws a typed budget-exceeded, so the scan degrades rather than crashing', async () => {
    const ledger = new CostLedger({ scanId: id });
    const blocked = withBudget(createDeterministicClient({ responders: [] }), ledger, 0);
    await expect(
      blocked.complete({ role: 'verifier', promptVersion: 'v1', messages: [], model: 'x', inputDigest: 'd' }),
    ).rejects.toMatchObject({ code: 'budget-exceeded' });
  });
});
