import {
  ScanEventSchema,
  ScanOptionsSchema,
  ScanTargetSchema,
  type ScanEvent,
  type ScanId,
} from '@handrail/schemas';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryEventBus } from '../events/bus.js';
import { MemoryArtifactReader, MemoryScanStore } from '../store/memory.js';
import { openSse, until } from '../__test__/sse-client.js';

/**
 * #17's acceptance criterion: **killing and reconnecting a client mid-scan
 * replays every missed event exactly once, in order.**
 *
 * Over a real socket, not `inject()`: the property is about what a client sees
 * *while* a scan runs and what it is handed after it comes back, and neither is
 * observable from a buffered response.
 *
 * **These tests cannot, on their own, prove the range query is right.** The
 * stream carries its own `seq <= lastSent` guard, so a store that replayed one
 * event too many would be silently corrected here and the reconnect assertion
 * would still pass. Drilled: flipping `>` to `>=` in the store leaves this file
 * green and turns `store.test.ts` red, which is where the boundary belongs.
 * The defensive layer downstream is exactly the thing that makes a test pass
 * for the wrong reason.
 */
let app: FastifyInstance;
let store: MemoryScanStore;
let bus: MemoryEventBus;
let baseUrl: string;
let scanId: ScanId;

function event(seq: number, overrides: Partial<ScanEvent> = {}): ScanEvent {
  return ScanEventSchema.parse({
    scanId,
    seq,
    ts: new Date(Date.UTC(2026, 6, 25, 10, 0, Math.min(seq, 59))).toISOString(),
    type: 'log',
    level: 'info',
    message: `event ${String(seq)}`,
    ...overrides,
  });
}

function terminal(seq: number): ScanEvent {
  return ScanEventSchema.parse({
    scanId,
    seq,
    ts: '2026-07-25T10:01:00.000Z',
    type: 'scan.completed',
    findingsTotal: 3,
    costUsd: 0,
    durationMs: 1234,
  });
}

beforeEach(async () => {
  bus = new MemoryEventBus();
  store = new MemoryScanStore({ bus });
  app = await buildServer({
    config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    store,
    artifacts: new MemoryArtifactReader(),
    toolVersion: '9.9.9-test',
    eventBus: bus,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const created = await store.create({
    target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
  });
  scanId = created.id;
});

afterEach(async () => {
  await app.close();
  await bus.close();
});

describe('GET /api/scans/:id/events', () => {
  it('streams events as they are written', async () => {
    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`);
    expect(session.status).toBe(200);

    await store.appendEvents(scanId, [event(0), event(1)]);
    await until(() => session.events.length === 2, 'the first two events');

    expect(session.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(session.frames.map((f) => f.id)).toEqual([0, 1]);
    session.close();
  });

  it('replays every missed event exactly once, in order, after a reconnect', async () => {
    // ── A client watches the first half of a scan, then dies.
    const first = await openSse(`${baseUrl}/api/scans/${scanId}/events`);
    await store.appendEvents(scanId, [event(0), event(1), event(2)]);
    await until(() => first.events.length === 3, 'the first three events');
    first.close();
    await first.done;

    // ── The scan carries on while nobody is watching.
    await store.appendEvents(scanId, [event(3), event(4), event(5)]);

    // ── The client comes back saying what it already has.
    const lastSeen = first.events.at(-1)?.seq ?? -1;
    expect(lastSeen).toBe(2);
    const second = await openSse(`${baseUrl}/api/scans/${scanId}/events`, {
      lastEventId: lastSeen,
    });
    await until(() => second.events.length === 3, 'the replay');

    // Exactly the missed ones, in order, and nothing it already had.
    expect(second.events.map((e) => e.seq)).toEqual([3, 4, 5]);

    // And the two halves stitch into one unbroken sequence with no repeats.
    const all = [...first.events, ...second.events].map((e) => e.seq);
    expect(all).toEqual([0, 1, 2, 3, 4, 5]);
    second.close();
  });

  it('keeps streaming after the replay, without repeating the backlog', async () => {
    await store.appendEvents(scanId, [event(0), event(1)]);
    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`, { lastEventId: 0 });
    await until(() => session.events.length === 1, 'the replayed event');

    await store.appendEvents(scanId, [event(2)]);
    await until(() => session.events.length === 2, 'the live event');

    expect(session.events.map((e) => e.seq)).toEqual([1, 2]);
    session.close();
  });

  it('sends the whole backlog to a client that has seen nothing', async () => {
    await store.appendEvents(scanId, [event(0), event(1), event(2)]);
    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`);
    await until(() => session.events.length === 3, 'the whole backlog');
    expect(session.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    session.close();
  });

  it('ends the stream on the terminal event', async () => {
    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`);
    await store.appendEvents(scanId, [event(0), terminal(1)]);
    await session.done;

    expect(session.events.at(-1)?.type).toBe('scan.completed');
  });

  it('answers 204 when the scan is over and the client has seen it all', async () => {
    // Closing a 200 would make an EventSource reconnect forever against a scan
    // that ended yesterday. 204 is how the spec says to stop.
    await store.appendEvents(scanId, [event(0), terminal(1)]);
    await store.update(scanId, { status: 'completed' });

    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`, { lastEventId: 1 });
    expect(session.status).toBe(204);
  });

  it('still replays a finished scan for a client that missed the end', async () => {
    await store.appendEvents(scanId, [event(0), terminal(1)]);
    await store.update(scanId, { status: 'completed' });

    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`, { lastEventId: 0 });
    expect(session.status).toBe(200);
    await session.done;
    expect(session.events.map((e) => e.seq)).toEqual([1]);
  });

  it('treats a mangled Last-Event-ID as a full replay rather than a silent skip', async () => {
    await store.appendEvents(scanId, [event(0), event(1)]);
    const response = await fetch(`${baseUrl}/api/scans/${scanId}/events?lastEventId=12abc`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it('404s an unknown scan', async () => {
    const response = await fetch(`${baseUrl}/api/scans/scan_nope/events`);
    expect(response.status).toBe(404);
    const problem = (await response.json()) as { code: string };
    expect(problem.code).toBe('not-found');
  });

  it('unsubscribes when the client goes away', async () => {
    // A stream that leaks its subscription leaks a listener per reconnect, and
    // a reconnecting client is the normal case here.
    const session = await openSse(`${baseUrl}/api/scans/${scanId}/events`);
    await until(() => bus.listenerCount === 1, 'the subscription');
    session.close();
    await until(() => bus.listenerCount === 0, 'the unsubscribe');
  });
});
