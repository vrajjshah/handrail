import { type ModelRole } from '@handrail/schemas';

import { type ModelRequest } from './types.js';

/**
 * Canonical Anthropic model ids, verified 2026-07-23 (ADR-0004). Bedrock exposes
 * the same models under `anthropic.`-prefixed ids; that mapping lives with the
 * Bedrock provider (#8), not here.
 */
export const HAIKU_4_5 = 'claude-haiku-4-5';
export const SONNET_5 = 'claude-sonnet-5';

/** The id used for `local-deterministic` completions. It reaches no network and costs nothing. */
export const DETERMINISTIC_MODEL = 'local-deterministic';

/**
 * Per-role model defaults from the locked decisions: Haiku 4.5 for the cheap,
 * high-volume roles (triage, text judgment, verification); Sonnet 5 where its
 * agentic quality and high-res vision earn the higher price (vision, fixes).
 * Ids are config-swappable — this is only the default when a call omits `model`.
 */
export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  triage: HAIKU_4_5,
  'text-judge': HAIKU_4_5,
  verifier: HAIKU_4_5,
  'vision-judge': SONNET_5,
  fix: SONNET_5,
};

/** Resolve the concrete model id for a request: explicit `model` wins, else the role default. */
export function resolveModel(request: Pick<ModelRequest, 'role' | 'model'>): string {
  return request.model ?? DEFAULT_ROLE_MODELS[request.role];
}
