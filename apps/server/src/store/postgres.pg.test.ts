import {
  ScanEventSchema,
  ScanOptionsSchema,
  ScanTargetSchema,
  scanId as toScanId,
  type ScanEvent,
  type ScanId,
} from '@handrail/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connect, runMigrations, type DatabaseHandle } from '../db/client.js';
import { PostgresScanStore } from './postgres.js';

/**
 * The durable store, against a real Postgres.
 *
 * `*.pg.test.ts` files are excluded from the default `unit` run and have their
 * own CI job with a `postgres` service — the three-OS matrix stays fast and
 * dependency-free, which is what keeps Windows and macOS in it at all.
 *
 *     docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=handrail \
 *       -e POSTGRES_USER=handrail -e POSTGRES_DB=handrail postgres:17-alpine
 *     DATABASE_URL=postgresql://handrail:handrail@localhost:5433/handrail \
 *       pnpm --filter @handrail/server test:pg
 */
const DATABASE_URL = process.env.DATABASE_URL;

const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });
const options = ScanOptionsSchema.parse({ mode: 'deterministic' });

function event(scanId: ScanId, seq: number): ScanEvent {
  return ScanEventSchema.parse({
    scanId,
    seq,
    ts: new Date(Date.UTC(2026, 6, 25, 10, 0, seq)).toISOString(),
    type: 'log',
    level: 'info',
    message: `event ${String(seq)}`,
  });
}

describe.skipIf(DATABASE_URL === undefined)('PostgresScanStore', () => {
  let database: DatabaseHandle;
  let store: PostgresScanStore;

  beforeAll(async () => {
    database = connect(DATABASE_URL ?? '', 2);
    await runMigrations(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Cascades to events and findings, so each test starts from nothing.
    await database.db.execute(sql`truncate table scans cascade`);
  });

  it('writes a scan and reads it back through the contract', async () => {
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options, clientIp: '203.0.113.9' });

    const stored = await store.get(created.id);
    expect(stored?.record.id).toBe(created.id);
    expect(stored?.record.status).toBe('queued');
    expect(stored?.report).toBeUndefined();
  });

  it('does not return the client IP to a caller', async () => {
    // It is stored for rate limiting and abuse forensics, and a `ScanRecord`
    // has no field for it — which is what stops it reaching a response body.
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options, clientIp: '203.0.113.9' });
    expect(JSON.stringify(await store.get(created.id))).not.toContain('203.0.113.9');
  });

  it('rejects a patch that would make the record invalid, and writes nothing', async () => {
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options });
    await expect(store.update(created.id, { status: 'vibing' as never })).rejects.toThrow();
    expect((await store.get(created.id))?.record.status).toBe('queued');
  });

  it('refuses two events with the same seq for one scan', async () => {
    // The primary key is `(scan_id, seq)` and `seq` is the SSE event id. A
    // duplicate would make a reconnecting client skip an event it never saw,
    // so the database refuses rather than trusting the writer.
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options });
    await store.appendEvents(created.id, [event(created.id, 0), event(created.id, 1)]);

    // Re-appending is harmless — a retried worker legitimately does this.
    await store.appendEvents(created.id, [event(created.id, 1), event(created.id, 2)]);

    const all = await store.eventsSince(created.id, -1);
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('replays strictly after a seq, in order', async () => {
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options });
    await store.appendEvents(
      created.id,
      [4, 0, 2, 1, 3].map((seq) => event(created.id, seq)),
    );

    expect((await store.eventsSince(created.id, -1)).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect((await store.eventsSince(created.id, 2)).map((e) => e.seq)).toEqual([3, 4]);
    expect(await store.lastSeq(created.id)).toBe(4);
  });

  it('reports -1 as the last seq for a scan that has emitted nothing', async () => {
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options });
    expect(await store.lastSeq(created.id)).toBe(-1);
    expect(await store.lastSeq(toScanId('scan_nope'))).toBe(-1);
  });

  it('aggregates stats without interpolating a percentile', async () => {
    store = new PostgresScanStore(database.db);
    for (const seconds of [10, 20, 30]) {
      const created = await store.create({ target, options });
      await store.update(created.id, {
        status: 'completed',
        startedAt: '2026-07-25T10:00:00.000Z',
        finishedAt: new Date(Date.UTC(2026, 6, 25, 10, 0, seconds)).toISOString(),
        costUsd: 0.1,
      });
    }

    const stats = await store.stats();
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(3);
    // Nearest rank: a duration a scan actually took, not an average of two.
    expect(stats.durationMs.p50).toBe(20_000);
    expect([10_000, 20_000, 30_000]).toContain(stats.durationMs.p50);
    expect(stats.costUsdTotal).toBeCloseTo(0.3, 6);
  });

  it('ignores a scan whose clock ran backwards rather than reporting a negative duration', async () => {
    store = new PostgresScanStore(database.db);
    const created = await store.create({ target, options });
    await store.update(created.id, {
      status: 'completed',
      startedAt: '2026-07-25T10:00:20.000Z',
      finishedAt: '2026-07-25T10:00:00.000Z',
    });
    expect((await store.stats()).durationMs.p50).toBeNull();
  });

  it('survives being read by a different store instance', async () => {
    // The property #18 exists for, at its smallest: what one process wrote,
    // another can read.
    const writer = new PostgresScanStore(database.db);
    const created = await writer.create({ target, options });
    await writer.appendEvents(created.id, [event(created.id, 0)]);

    const second = connect(DATABASE_URL ?? '', 1);
    try {
      const reader = new PostgresScanStore(second.db);
      expect((await reader.get(created.id))?.record.id).toBe(created.id);
      expect(await reader.lastSeq(created.id)).toBe(0);
    } finally {
      await second.close();
    }
  });
});
