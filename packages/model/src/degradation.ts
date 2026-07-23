import {
  type Degradation,
  DegradationSchema,
  type ScanPhase,
} from '@handrail/schemas';

import { type ModelError } from './errors.js';

export interface DegradationContext {
  /** The pipeline phase that was running when the model failed. */
  phase?: ScanPhase;
  /** When the degradation is recorded. Defaults to now. */
  at?: Date;
}

/**
 * Map a typed model failure onto the scan-level degradation it causes. A blown
 * budget is its own reason; every other failure means the model was, for this
 * scan, unavailable — which is exactly what the report must say rather than
 * quietly shipping deterministic-only results. This is the seam-level half of
 * trust invariant 1: the orchestrator appends the returned degradation to the
 * `ScanRecord`, and `isDegraded` then reports true.
 */
export function degradationForModelError(
  error: ModelError,
  context: DegradationContext = {},
): Degradation {
  const reason = error.code === 'budget-exceeded' ? 'budget-exhausted' : 'model-unavailable';
  const at = (context.at ?? new Date()).toISOString();
  const providerLabel = error.provider ? `${error.provider}: ` : '';

  return DegradationSchema.parse({
    reason,
    detail: `${providerLabel}${error.code} — ${error.message}`.slice(0, 2000),
    ...(context.phase === undefined ? {} : { phase: context.phase }),
    at,
  });
}
