import { scId } from '@handrail/schemas';

import type { KnownScId, SuccessCriterion } from './types.js';

/**
 * Mints the branded `id` from `num` so no criterion can carry a mismatched pair.
 *
 * Generic in `N` on purpose: it preserves the literal criterion number through
 * to the call site, which is what lets `index.ts` prove at compile time that the
 * defined set is exactly {@link KnownScId} — no more, no less.
 */
export function define<N extends KnownScId>(
  criterion: Omit<SuccessCriterion, 'id' | 'num'> & { num: N },
): SuccessCriterion & { num: N } {
  return { ...criterion, id: scId(criterion.num) };
}
