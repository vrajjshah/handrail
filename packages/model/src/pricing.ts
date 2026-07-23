import { type ModelProvider, type TokenUsage } from '@handrail/schemas';

import { HAIKU_4_5, SONNET_5 } from './models.js';

/**
 * Thrown when a real, billable model has no registered price. This is a
 * programming error, not a runtime provider failure: it means a provider was
 * wired up (#8) without teaching the ledger what its tokens cost, which would
 * silently understate COST.md. Failing loudly here is the honest choice.
 */
export class UnknownModelPriceError extends Error {
  override readonly name = 'UnknownModelPriceError';
  readonly model: string;
  constructor(model: string) {
    super(`no registered price for model "${model}"`);
    this.model = model;
  }
}

/**
 * Prices in US dollars per million tokens. Cache multipliers are applied to the
 * effective input price: reads bill at ≈0.1× (ADR-0004), writes at the standard
 * 5-minute-TTL rate of 1.25×. Verified 2026-07-23.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
  /** A time-boxed promotional rate that supersedes the standard one until `until`. */
  intro?: {
    inputPerMTok: number;
    outputPerMTok: number;
    until: Date;
  };
}

/** Sonnet 5's introductory pricing runs through 2026-08-31 inclusive (ADR-0004). */
export const SONNET_5_INTRO_UNTIL = new Date('2026-08-31T23:59:59.999Z');

export const MODEL_PRICES: Record<string, ModelPrice> = {
  [HAIKU_4_5]: {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
  },
  [SONNET_5]: {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    intro: { inputPerMTok: 2, outputPerMTok: 10, until: SONNET_5_INTRO_UNTIL },
  },
};

export function priceFor(model: string): ModelPrice | undefined {
  return MODEL_PRICES[model];
}

function effectiveRates(price: ModelPrice, at: Date): { input: number; output: number } {
  if (price.intro && at.getTime() <= price.intro.until.getTime()) {
    return { input: price.intro.inputPerMTok, output: price.intro.outputPerMTok };
  }
  return { input: price.inputPerMTok, output: price.outputPerMTok };
}

export interface CostInputs {
  provider: ModelProvider;
  model: string;
  usage: TokenUsage;
  /** When the call happened — governs which promotional window applies. Defaults to now. */
  at?: Date;
}

/**
 * The single place a dollar figure is derived from token counts. Deterministic
 * calls are always free — that is not a price lookup, it is a property of the
 * provider — so they short-circuit before any table access. Everything else must
 * be priced; an unpriced billable model throws rather than reporting $0.
 */
export function computeCostUsd({ provider, model, usage, at = new Date() }: CostInputs): number {
  if (provider === 'local-deterministic') return 0;

  const price = priceFor(model);
  if (price === undefined) throw new UnknownModelPriceError(model);

  const { input, output } = effectiveRates(price, at);
  const dollars =
    usage.input * input +
    usage.output * output +
    usage.cacheRead * input * price.cacheReadMultiplier +
    usage.cacheWrite * input * price.cacheWriteMultiplier;

  return dollars / 1_000_000;
}
