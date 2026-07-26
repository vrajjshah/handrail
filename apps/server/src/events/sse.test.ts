import { ScanEventSchema, scanId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import {
  NOTHING_SEEN,
  SSE_HEADERS,
  eventsOwed,
  frameComment,
  frameEvent,
  frameRetry,
  parseLastEventId,
} from './sse.js';

const event = (seq: number) =>
  ScanEventSchema.parse({
    scanId: scanId('scan_1'),
    seq,
    ts: '2026-07-25T10:00:00.000Z',
    type: 'log',
    level: 'info',
    message: `event ${String(seq)}`,
  });

describe('parseLastEventId', () => {
  it('reads a number the client sends back', () => {
    expect(parseLastEventId('7')).toBe(7);
    expect(parseLastEventId(' 7 ')).toBe(7);
    expect(parseLastEventId('0')).toBe(0);
  });

  it('treats anything unreadable as "seen nothing"', () => {
    // Replaying an event a client already has is a duplicate it can drop.
    // Skipping one is a hole it can never learn about. When the two failure
    // modes are not symmetric, take the recoverable one.
    for (const value of [undefined, '', '   ', 'abc', '12abc', '1e3', '9'.repeat(30), 'NaN', '-5']) {
      expect(parseLastEventId(value)).toBe(NOTHING_SEEN);
    }
  });

  it('does not truncate a mangled header to a plausible number', () => {
    // `12abc` reading as 12 would silently skip everything after event 12.
    expect(parseLastEventId('12abc')).toBe(NOTHING_SEEN);
  });

  it('takes the first value when a proxy duplicates the header', () => {
    expect(parseLastEventId(['4', '9'])).toBe(4);
  });
});

describe('frameEvent', () => {
  it('uses seq as the SSE id, which is the whole design', () => {
    const framed = frameEvent(event(3));
    expect(framed).toContain('id: 3\n');
    expect(framed).toContain('event: log\n');
    expect(framed.endsWith('\n\n')).toBe(true);
  });

  it('puts the whole event in data, on one line', () => {
    const framed = frameEvent(event(3));
    const dataLine = framed.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    // A newline inside `data:` would split one event into two frames, and
    // JSON.stringify escapes them — which is why the payload is JSON and not
    // anything a page's own text could reach.
    expect(JSON.parse(dataLine?.slice(6) ?? '')).toEqual(event(3));
  });
});

describe('frameComment and frameRetry', () => {
  it('frames a keep-alive as a comment', () => {
    expect(frameComment('keep-alive')).toBe(': keep-alive\n\n');
  });

  it('frames a retry hint', () => {
    expect(frameRetry(2000)).toBe('retry: 2000\n\n');
  });
});

describe('eventsOwed', () => {
  const all = [0, 1, 2, 3, 4].map(event);

  it('is everything for a client that has seen nothing', () => {
    expect(eventsOwed(all, NOTHING_SEEN).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is strictly after what the client has', () => {
    // `Last-Event-ID: 2` means "I have through 2", so 2 is not owed again.
    expect(eventsOwed(all, 2).map((e) => e.seq)).toEqual([3, 4]);
  });

  it('is empty for a client that is up to date, or ahead', () => {
    expect(eventsOwed(all, 4)).toEqual([]);
    expect(eventsOwed(all, 99)).toEqual([]);
  });

  it('orders by seq regardless of the order it was handed', () => {
    const shuffled = [3, 0, 4, 1, 2].map(event);
    expect(eventsOwed(shuffled, NOTHING_SEEN).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('SSE_HEADERS', () => {
  it('defeats every layer that would otherwise buffer or cache the stream', () => {
    expect(SSE_HEADERS['content-type']).toContain('text/event-stream');
    expect(SSE_HEADERS['cache-control']).toContain('no-cache');
    // nginx buffers proxied responses by default, turning a live stream into
    // one long pause followed by everything at once.
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  });
});
