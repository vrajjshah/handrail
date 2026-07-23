import { type ModelProvider } from '@handrail/schemas';

import { DETERMINISTIC_MODEL, HAIKU_4_5, SONNET_5 } from './models.js';

/**
 * What a model will and will not accept. These facts are encoded as data — never
 * discovered at runtime by string-matching a model id — so that the ADR-0004
 * constraints (Sonnet 5 rejects sampling params, adaptive thinking is on by
 * default, Bedrock's forced `tool_choice` needs thinking disabled) live in one
 * auditable table instead of scattered `if (model.includes('sonnet'))` checks,
 * which is the spike pitfall this map exists to avoid.
 */
export interface ModelCapabilities {
  /** Native structured outputs via `output_config.format` + `zodOutputFormat`. */
  supportsStructuredOutput: boolean;
  /** Whether `temperature`/`top_p`/`top_k` may be set at non-default values. */
  allowsSamplingParams: boolean;
  /**
   * The thinking mode the seam must set *explicitly*. When a model runs adaptive
   * thinking by default, omitting it lets `max_tokens` silently cap thinking and
   * response together — so the seam always states the mode rather than defaulting.
   */
  defaultThinking: 'adaptive' | 'disabled';
  /** Bedrock only: a forced `tool_choice` requires `thinking: {type: "disabled"}`. */
  forcedToolChoiceRequiresThinkingDisabled: boolean;
  /**
   * The smallest prompt prefix that can be cached, in tokens. A prefix below this
   * floor silently never caches (`cache_creation_input_tokens` stays 0), so the
   * cost model must not assume a hit below it — Haiku 4.5 is 4096, Sonnet 5 is 2048.
   */
  minCacheablePrefixTokens: number;
  /** Longest image edge the model ingests at full resolution, in pixels. */
  visionMaxImageDimensionPx: number | undefined;
}

export class UnknownModelCapabilityError extends Error {
  override readonly name = 'UnknownModelCapabilityError';
  readonly provider: ModelProvider;
  readonly model: string;
  constructor(provider: ModelProvider, model: string) {
    super(`no registered capabilities for model "${model}" on provider "${provider}"`);
    this.provider = provider;
    this.model = model;
  }
}

const DETERMINISTIC_CAPABILITIES: ModelCapabilities = {
  supportsStructuredOutput: true,
  allowsSamplingParams: true,
  defaultThinking: 'disabled',
  forcedToolChoiceRequiresThinkingDisabled: false,
  minCacheablePrefixTokens: 0,
  visionMaxImageDimensionPx: undefined,
};

/** Base capabilities keyed by model, expressing Anthropic-native semantics. */
const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  [HAIKU_4_5]: {
    supportsStructuredOutput: true,
    allowsSamplingParams: true,
    defaultThinking: 'disabled',
    forcedToolChoiceRequiresThinkingDisabled: false,
    minCacheablePrefixTokens: 4096,
    visionMaxImageDimensionPx: 1568,
  },
  [SONNET_5]: {
    supportsStructuredOutput: true,
    allowsSamplingParams: false,
    defaultThinking: 'adaptive',
    forcedToolChoiceRequiresThinkingDisabled: false,
    minCacheablePrefixTokens: 2048,
    visionMaxImageDimensionPx: 2576,
  },
};

/**
 * Look up a model's capabilities for a given provider. `local-deterministic` is
 * permissive and free of the hosted-model constraints; Bedrock overlays the one
 * difference it has from Anthropic-native (forced-tool-choice needs thinking off).
 * An unpriced/unmapped billable model throws rather than guessing.
 */
export function capabilityFor(provider: ModelProvider, model: string): ModelCapabilities {
  if (provider === 'local-deterministic' || model === DETERMINISTIC_MODEL) {
    return DETERMINISTIC_CAPABILITIES;
  }

  const base = MODEL_CAPABILITIES[model];
  if (base === undefined) throw new UnknownModelCapabilityError(provider, model);

  if (provider === 'bedrock') {
    return { ...base, forcedToolChoiceRequiresThinkingDisabled: true };
  }
  return base;
}
