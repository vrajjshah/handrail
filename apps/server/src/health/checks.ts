/**
 * Readiness, as a composition of things that can actually be true or false.
 *
 * The distinction this module exists for: **"the container is up" and "a scan
 * can run" are different claims, and only the second one matters.** A process
 * that is alive but cannot launch Chromium will accept scans, queue them, and
 * fail every one — while every dashboard stays green. That is worse than being
 * down, because nothing is trying to fix it.
 */
export interface ReadinessCheck {
  name: string;
  /** Resolve with a detail string, or throw. A throw is the failure. */
  run: () => Promise<string>;
  /** How long it may take before it counts as failed. */
  timeoutMs?: number;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface ReadinessResult {
  ready: boolean;
  checks: CheckResult[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function withTimeout(check: ReadinessCheck, now: () => number): Promise<CheckResult> {
  const started = now();
  const limit = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${String(limit)}ms`)),
      limit,
    );
    timer.unref?.();
  });

  try {
    const detail = await Promise.race([check.run(), timeout]);
    return { name: check.name, ok: true, detail, durationMs: now() - started };
  } catch (error) {
    // A hung dependency is a failed dependency. Without the timeout, `/readyz`
    // hangs too, and a load balancer waiting on it cannot tell "unhealthy" from
    // "slow" — so it keeps sending traffic to a container that answers nothing.
    return {
      name: check.name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: now() - started,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run every check, always.
 *
 * Not short-circuited on the first failure: an operator reading `/readyz`
 * wants the whole picture. "Postgres is down" and "Postgres is down *and*
 * Chromium is missing" are different mornings.
 */
export async function runReadiness(
  checks: readonly ReadinessCheck[],
  options: { now?: () => number } = {},
): Promise<ReadinessResult> {
  const now = options.now ?? (() => Date.now());
  const results = await Promise.all(checks.map((check) => withTimeout(check, now)));
  return { ready: results.every((result) => result.ok), checks: results };
}

/**
 * Remember a success for a while; never remember a failure.
 *
 * Launching Chromium costs a second or two, and a platform polls readiness
 * every few seconds — doing it for real each time would be a self-inflicted
 * load. But caching a *failure* would keep reporting red after the problem is
 * fixed, and worse, caching a success across a genuine break would keep
 * reporting green. Only the good answer is cached, and only briefly.
 */
export function cacheSuccess(
  check: ReadinessCheck,
  ttlMs: number,
  now: () => number = () => Date.now(),
): ReadinessCheck {
  let goodUntil = 0;
  let lastDetail = '';

  return {
    ...check,
    run: async () => {
      if (now() < goodUntil) return `${lastDetail} (cached)`;
      const detail = await check.run();
      goodUntil = now() + ttlMs;
      lastDetail = detail;
      return detail;
    },
  };
}
