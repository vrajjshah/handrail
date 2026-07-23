import { scanId } from '@handrail/schemas';

import { CostLedger, type CostLedgerOptions } from '../ledger.js';
import { type ModelRequest } from '../types.js';

/**
 * A clock that starts at `startMs` and advances a fixed step on every read. The
 * ledger reads it twice per call (start, then end), so latency comes out as
 * exactly `stepMs` — deterministic, which is the whole point of the seam.
 */
export function steppingClock(startMs = 0, stepMs = 5): () => Date {
  let t = startMs;
  return () => {
    const now = new Date(t);
    t += stepMs;
    return now;
  };
}

export function counterIds(prefix = 'inv_'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** A ledger wired with deterministic clock and ids unless overridden. */
export function testLedger(options: Partial<CostLedgerOptions> = {}): CostLedger {
  return new CostLedger({
    scanId: scanId('scan_test'),
    now: steppingClock(),
    newId: counterIds(),
    ...options,
  });
}

export function textRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    role: 'text-judge',
    promptVersion: 'v1',
    messages: [{ role: 'user', content: 'is this link purpose clear?' }],
    ...overrides,
  };
}

/** Pull the last recorded row without tripping `noUncheckedIndexedAccess`. */
export function lastOf<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}
