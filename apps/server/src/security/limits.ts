import { timingSafeEqual } from 'node:crypto';

/**
 * What a stranger is allowed to ask this deployment for.
 *
 * The numbers are the plan's, and they are ceilings rather than defaults: a
 * request cannot raise them, because the request body has no field that
 * expresses them. This module is where they are stated once, so a later screen
 * or a later surface cannot quietly pick different ones.
 */
export const HOSTED_LIMITS = {
  /** Per IP, per hour. Enough to try your own site a few times, not to mine ours. */
  scansPerHourPerIp: 3,
  /** Concurrent scans across the whole deployment. A scan is a whole browser. */
  globalConcurrentScans: 2,
  /** Pages per scan. The plan's hosted figure; the CLI allows 25. */
  maxPages: 5,
  /** Ten minutes. A scan that has not finished by then has found what it will. */
  maxDurationMs: 10 * 60 * 1000,
  /** A token ceiling, so a pathological page cannot spend the month's budget. */
  maxModelTokens: 200_000,
  /** Dollars per scan, on top of the token cap. */
  maxUsd: 0.5,
} as const;

export const RATE_WINDOW_MS = 60 * 60 * 1000;

export type LimitReason = 'per-ip' | 'global-concurrency';

export interface LimitDecision {
  allowed: boolean;
  reason?: LimitReason;
  /** How long to wait, in seconds. Rendered as words, per DESIGN.md §8.2. */
  retryAfterSeconds?: number;
}

export const ALLOWED: LimitDecision = { allowed: true };

export interface LimitInput {
  /** Scans this IP started inside the window, oldest first. */
  recentByIp: readonly Date[];
  /** Scans currently running across the deployment. */
  runningNow: number;
  now: Date;
}

/**
 * The rate-limit decision, as a pure function of counts.
 *
 * Pure so the arithmetic — especially `retryAfter`, which is the only part a
 * user sees — can be tested without a clock, a database or an HTTP request.
 *
 * A **sliding** window, computed from the timestamps of real scans rather than
 * a counter in a bucket. A fixed hourly bucket lets someone take six scans
 * across a boundary two minutes apart, and the honest thing to tell a person
 * who is waiting is when their oldest scan ages out — which a bucket cannot say.
 */
export function checkLimits(input: LimitInput): LimitDecision {
  const windowStart = input.now.getTime() - RATE_WINDOW_MS;
  const inWindow = input.recentByIp
    .filter((at) => at.getTime() > windowStart)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length >= HOSTED_LIMITS.scansPerHourPerIp) {
    const oldest = inWindow[0];
    const freesAt = (oldest?.getTime() ?? input.now.getTime()) + RATE_WINDOW_MS;
    return {
      allowed: false,
      reason: 'per-ip',
      retryAfterSeconds: Math.max(1, Math.ceil((freesAt - input.now.getTime()) / 1000)),
    };
  }

  if (input.runningNow >= HOSTED_LIMITS.globalConcurrentScans) {
    return {
      allowed: false,
      reason: 'global-concurrency',
      // No timestamp to reason from: this clears when a scan finishes, and a
      // scan takes minutes. A minute is an honest "try again shortly".
      retryAfterSeconds: 60,
    };
  }

  return ALLOWED;
}

/** What the user is told. Not an error — an explained wait, per DESIGN.md §8.2. */
export function limitMessage(decision: LimitDecision): string {
  const wait = decision.retryAfterSeconds ?? 60;
  const minutes = Math.ceil(wait / 60);
  const inWords = minutes <= 1 ? 'about a minute' : `about ${String(minutes)} minutes`;

  if (decision.reason === 'per-ip') {
    return (
      `This demo allows ${String(HOSTED_LIMITS.scansPerHourPerIp)} scans an hour from one ` +
      `address, so that it stays free for everyone. Try again in ${inWords} — or run the ` +
      'CLI against your own machine, where there is no limit.'
    );
  }
  return (
    `Two scans are already running, and each one drives a real browser. Try again in ${inWords}.`
  );
}

/**
 * Constant-time admin-token comparison.
 *
 * `===` on a secret leaks its length and its matching prefix to anyone patient
 * enough to measure. `timingSafeEqual` throws on a length mismatch, which would
 * leak the length by a different route, so both sides are hashed to a fixed
 * width first.
 */
export function matchesAdminToken(provided: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) return false;
  if (provided === undefined || provided.length === 0) return false;

  const a = Buffer.from(provided.padEnd(128, '\0').slice(0, 128), 'utf8');
  const b = Buffer.from(expected.padEnd(128, '\0').slice(0, 128), 'utf8');
  return timingSafeEqual(a, b) && provided.length === expected.length;
}
