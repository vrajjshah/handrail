import { type TokenUsage } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { HAIKU_4_5, SONNET_5 } from './models.js';
import {
  computeCostUsd,
  MODEL_PRICES,
  priceFor,
  SONNET_5_INTRO_UNTIL,
  UnknownModelPriceError,
} from './pricing.js';

function usage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...partial };
}

const AFTER_INTRO = new Date('2026-09-01T00:00:00.000Z');
const DURING_INTRO = new Date('2026-08-15T00:00:00.000Z');

describe('computeCostUsd', () => {
  it('prices Haiku 4.5 input and output at $1 / $5 per MTok', () => {
    const cost = computeCostUsd({
      provider: 'anthropic',
      model: HAIKU_4_5,
      usage: usage({ input: 1_000_000, output: 1_000_000 }),
      at: AFTER_INTRO,
    });
    expect(cost).toBeCloseTo(6, 10);
  });

  it('applies the cache-read discount and cache-write premium off the input price', () => {
    const cost = computeCostUsd({
      provider: 'anthropic',
      model: HAIKU_4_5,
      usage: usage({ cacheRead: 1_000_000, cacheWrite: 1_000_000 }),
      at: AFTER_INTRO,
    });
    // read at 0.1x $1 = $0.10, write at 1.25x $1 = $1.25.
    expect(cost).toBeCloseTo(1.35, 10);
  });

  it('charges Sonnet 5 the standard $3 / $15 after the intro window', () => {
    const cost = computeCostUsd({
      provider: 'anthropic',
      model: SONNET_5,
      usage: usage({ input: 1_000_000, output: 1_000_000 }),
      at: AFTER_INTRO,
    });
    expect(cost).toBeCloseTo(18, 10);
  });

  it('charges Sonnet 5 the intro $2 / $10 during the intro window', () => {
    const cost = computeCostUsd({
      provider: 'anthropic',
      model: SONNET_5,
      usage: usage({ input: 1_000_000, output: 1_000_000 }),
      at: DURING_INTRO,
    });
    expect(cost).toBeCloseTo(12, 10);
  });

  it('treats the last instant of 2026-08-31 as still inside the intro window', () => {
    const intro = computeCostUsd({
      provider: 'anthropic',
      model: SONNET_5,
      usage: usage({ input: 1_000_000 }),
      at: SONNET_5_INTRO_UNTIL,
    });
    const standard = computeCostUsd({
      provider: 'anthropic',
      model: SONNET_5,
      usage: usage({ input: 1_000_000 }),
      at: new Date(SONNET_5_INTRO_UNTIL.getTime() + 1),
    });
    expect(intro).toBeCloseTo(2, 10);
    expect(standard).toBeCloseTo(3, 10);
  });

  it('is always $0 for the local-deterministic provider, whatever the tokens', () => {
    const cost = computeCostUsd({
      provider: 'local-deterministic',
      model: SONNET_5,
      usage: usage({ input: 9_999_999, output: 9_999_999 }),
    });
    expect(cost).toBe(0);
  });

  it('throws rather than silently reporting $0 for an unpriced billable model', () => {
    expect(() =>
      computeCostUsd({ provider: 'anthropic', model: 'gpt-imaginary', usage: usage() }),
    ).toThrow(UnknownModelPriceError);
  });
});

describe('the price table', () => {
  it('prices every model it exposes', () => {
    for (const model of Object.keys(MODEL_PRICES)) {
      expect(priceFor(model)).toBeDefined();
    }
  });
});
