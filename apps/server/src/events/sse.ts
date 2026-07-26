import type { ScanEvent } from '@handrail/schemas';

/**
 * Server-sent events, framed.
 *
 * Pure functions, because the interesting part of SSE is not the transport —
 * it is the arithmetic of *which* events a reconnecting client is owed, and
 * that should be testable without a socket.
 *
 * Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

/** No `Last-Event-ID` means the client has seen nothing, which is `seq > -1`. */
export const NOTHING_SEEN = -1;

/**
 * The last `seq` a client says it already has.
 *
 * `Last-Event-ID` is whatever string the client sends back — it may be absent,
 * empty, a leftover from a different scan, or garbage from a proxy. Anything
 * unreadable is treated as "seen nothing", because replaying an event a client
 * already has is a duplicate it can drop, while skipping one is a hole it can
 * never learn about. When the two failure modes are not symmetric, take the
 * recoverable one.
 */
export function parseLastEventId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return NOTHING_SEEN;
  const trimmed = value.trim();
  if (trimmed.length === 0) return NOTHING_SEEN;
  // Deliberately strict: `12abc` is not 12. A proxy that mangles the header
  // should cause a full replay, not a silent truncation to a plausible number.
  if (!/^-?\d+$/.test(trimmed)) return NOTHING_SEEN;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < NOTHING_SEEN) return NOTHING_SEEN;
  return parsed;
}

/** One SSE frame. The event id is the scan event's `seq` — that is the whole design. */
export function frameEvent(event: ScanEvent): string {
  return [`id: ${String(event.seq)}`, `event: ${event.type}`, `data: ${JSON.stringify(event)}`, '', ''].join(
    '\n',
  );
}

/**
 * A comment frame. Two jobs: it defeats the idle timeout on every proxy between
 * here and the reader, and it flushes any buffering one that is holding bytes
 * back waiting for a "complete" response.
 */
export function frameComment(text: string): string {
  return `: ${text}\n\n`;
}

/** Tells the client how long to wait before reconnecting, in milliseconds. */
export function frameRetry(ms: number): string {
  return `retry: ${String(ms)}\n\n`;
}

/**
 * Events a client with `lastSeq` is owed, in order.
 *
 * Exported and tested separately because "exactly once, in order" is the
 * acceptance criterion, and an acceptance criterion that only exists inside a
 * route handler cannot be asserted on its own.
 */
export function eventsOwed(
  events: readonly ScanEvent[],
  lastSeq: number,
): ScanEvent[] {
  return events.filter((event) => event.seq > lastSeq).sort((a, b) => a.seq - b.seq);
}

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  // A cached event stream is a stream that never updates.
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // nginx buffers proxied responses by default, which turns a live stream into
  // one long pause followed by everything at once.
  'x-accel-buffering': 'no',
};
