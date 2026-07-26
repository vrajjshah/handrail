import { describe, expect, it } from 'vitest';

import {
  HOSTED_LIMITS,
  RATE_WINDOW_MS,
  checkLimits,
  limitMessage,
  matchesAdminToken,
} from './limits.js';

const now = new Date('2026-07-25T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

describe('checkLimits', () => {
  it('allows a first scan', () => {
    expect(checkLimits({ recentByIp: [], runningNow: 0, now })).toEqual({ allowed: true });
  });

  it('allows up to the per-IP limit and refuses the next', () => {
    const two = [minutesAgo(50), minutesAgo(20)];
    expect(checkLimits({ recentByIp: two, runningNow: 0, now }).allowed).toBe(true);

    const three = [...two, minutesAgo(5)];
    const decision = checkLimits({ recentByIp: three, runningNow: 0, now });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('per-ip');
  });

  it('slides, so a scan older than the window does not count', () => {
    // A fixed hourly bucket would let six scans through two minutes apart
    // across a boundary. The window moves with the clock.
    const aged = [minutesAgo(61), minutesAgo(70), minutesAgo(200)];
    expect(checkLimits({ recentByIp: aged, runningNow: 0, now }).allowed).toBe(true);
  });

  it('says when the oldest scan ages out, not a flat guess', () => {
    // The only honest answer to "when can I try again" is when the oldest one
    // leaves the window — which a counter in a bucket cannot say.
    const decision = checkLimits({
      recentByIp: [minutesAgo(50), minutesAgo(20), minutesAgo(5)],
      runningNow: 0,
      now,
    });
    expect(decision.retryAfterSeconds).toBe((RATE_WINDOW_MS - 50 * 60_000) / 1000);
  });

  it('does not care what order the timestamps arrive in', () => {
    const shuffled = [minutesAgo(5), minutesAgo(50), minutesAgo(20)];
    expect(checkLimits({ recentByIp: shuffled, runningNow: 0, now }).retryAfterSeconds).toBe(
      (RATE_WINDOW_MS - 50 * 60_000) / 1000,
    );
  });

  it('refuses when the deployment is already at its concurrency cap', () => {
    const decision = checkLimits({
      recentByIp: [],
      runningNow: HOSTED_LIMITS.globalConcurrentScans,
      now,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('global-concurrency');
  });

  it('reports the per-IP limit first when both apply', () => {
    // The per-IP one is the actionable message: "wait 12 minutes" beats "the
    // service is busy" when the reason it is busy is you.
    const decision = checkLimits({
      recentByIp: [minutesAgo(1), minutesAgo(2), minutesAgo(3)],
      runningNow: 5,
      now,
    });
    expect(decision.reason).toBe('per-ip');
  });

  it('never returns a retry of zero', () => {
    const decision = checkLimits({
      recentByIp: [minutesAgo(60), minutesAgo(60), minutesAgo(60)],
      runningNow: 0,
      now,
    });
    // Those are exactly on the boundary; whichever way it falls, a client told
    // to retry in 0 seconds retries immediately and is refused again.
    if (!decision.allowed) expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('limitMessage', () => {
  it('explains the wait in words and offers the way around it', () => {
    const message = limitMessage({ allowed: false, reason: 'per-ip', retryAfterSeconds: 600 });
    expect(message).toContain('about 10 minutes');
    expect(message).toContain('CLI');
    // Never blames the user, per DESIGN.md §10.
    expect(message).not.toMatch(/you (have )?(abused|exceeded)/i);
  });

  it('says "about a minute" rather than "1 minutes"', () => {
    expect(limitMessage({ allowed: false, reason: 'per-ip', retryAfterSeconds: 30 })).toContain(
      'about a minute',
    );
  });

  it('explains the concurrency cap in terms of what a scan costs', () => {
    const message = limitMessage({
      allowed: false,
      reason: 'global-concurrency',
      retryAfterSeconds: 60,
    });
    expect(message).toContain('real browser');
  });
});

describe('matchesAdminToken', () => {
  const token = 'a'.repeat(40);

  it('accepts the exact token', () => {
    expect(matchesAdminToken(token, token)).toBe(true);
  });

  it('rejects a wrong token, a prefix, and a suffix', () => {
    expect(matchesAdminToken('b'.repeat(40), token)).toBe(false);
    expect(matchesAdminToken('a'.repeat(39), token)).toBe(false);
    expect(matchesAdminToken(`${token}a`, token)).toBe(false);
  });

  it('rejects everything when no token is configured', () => {
    // A deployment that has not set one must not be bypassable by sending
    // nothing, or by sending the empty string.
    expect(matchesAdminToken(undefined, undefined)).toBe(false);
    expect(matchesAdminToken('', undefined)).toBe(false);
    expect(matchesAdminToken('anything', undefined)).toBe(false);
    expect(matchesAdminToken('anything', '')).toBe(false);
  });

  it('rejects a missing header against a configured token', () => {
    expect(matchesAdminToken(undefined, token)).toBe(false);
    expect(matchesAdminToken('', token)).toBe(false);
  });

  it('handles a token longer than the comparison buffer', () => {
    const long = 'z'.repeat(500);
    expect(matchesAdminToken(long, long)).toBe(true);
    expect(matchesAdminToken(`${long}!`, long)).toBe(false);
  });
});

describe('HOSTED_LIMITS', () => {
  it('matches the plan: 3 an hour, 2 at once, 5 pages, 10 minutes', () => {
    expect(HOSTED_LIMITS.scansPerHourPerIp).toBe(3);
    expect(HOSTED_LIMITS.globalConcurrentScans).toBe(2);
    expect(HOSTED_LIMITS.maxPages).toBe(5);
    expect(HOSTED_LIMITS.maxDurationMs).toBe(600_000);
  });
});
