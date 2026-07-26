/**
 * Percentiles, computed the way an operator expects to read them.
 *
 * The nearest-rank method: p95 of ten samples is the tenth-slowest, not an
 * interpolation between the ninth and tenth. Interpolating invents a duration
 * no scan actually took, which is a strange thing for a latency figure to be —
 * and the two methods disagree most at exactly the small sample sizes a fresh
 * deployment has.
 */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  if (p <= 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(p, 100) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

export function p50(samples: readonly number[]): number | null {
  return percentile(samples, 50);
}

export function p95(samples: readonly number[]): number | null {
  return percentile(samples, 95);
}

/** Wall-clock duration of a finished scan, or null while it is still running. */
export function durationMsOf(scan: {
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}): number | null {
  if (scan.startedAt === undefined || scan.finishedAt === undefined) return null;
  const started = Date.parse(scan.startedAt);
  const finished = Date.parse(scan.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) return null;
  // A clock that went backwards is a broken measurement, not a negative
  // duration. Reporting −4s in a p50 would be worse than reporting nothing.
  return finished < started ? null : finished - started;
}
