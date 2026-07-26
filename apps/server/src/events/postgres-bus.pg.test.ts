import { ScanEventSchema, ScanOptionsSchema, ScanTargetSchema } from '@handrail/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connect, runMigrations, type DatabaseHandle } from '../db/client.js';
import { PostgresScanStore } from '../store/postgres.js';
import { until } from '../__test__/sse-client.js';
import { PostgresEventBus } from './postgres-bus.js';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The cross-process half of the SSE stream.
 *
 * In production the worker writing events and the API serving them are
 * different processes, so the in-memory bus cannot carry the nudge. This is
 * `LISTEN`/`NOTIFY` doing it — with two separate connections, which is the
 * situation being modelled.
 */
describe.skipIf(DATABASE_URL === undefined)('PostgresEventBus', () => {
  let writerDb: DatabaseHandle;
  let readerDb: DatabaseHandle;
  let writerBus: PostgresEventBus;
  let readerBus: PostgresEventBus;

  beforeAll(async () => {
    writerDb = connect(DATABASE_URL ?? '', 2);
    readerDb = connect(DATABASE_URL ?? '', 2);
    await runMigrations(writerDb.db);
    writerBus = new PostgresEventBus({ connectionString: DATABASE_URL ?? '', pool: writerDb.pool });
    readerBus = new PostgresEventBus({ connectionString: DATABASE_URL ?? '', pool: readerDb.pool });
  });

  afterAll(async () => {
    await writerBus.close();
    await readerBus.close();
    await writerDb.close();
    await readerDb.close();
  });

  beforeEach(async () => {
    await writerDb.db.execute(sql`truncate table scans cascade`);
  });

  it('delivers a write in one connection to a listener on another', async () => {
    const store = new PostgresScanStore(writerDb.db, { bus: writerBus });
    const scan = await store.create({
      target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
      options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    });

    let nudges = 0;
    const unsubscribe = await readerBus.subscribe(scan.id, () => {
      nudges += 1;
    });

    await store.appendEvents(scan.id, [
      ScanEventSchema.parse({
        scanId: scan.id,
        seq: 0,
        ts: '2026-07-25T10:00:00.000Z',
        type: 'log',
        level: 'info',
        message: 'hello from the worker',
      }),
    ]);

    await until(() => nudges > 0, 'the notification to cross connections');
    await unsubscribe();
  });

  it('does not wake a listener watching a different scan', async () => {
    // One channel carries every scan, filtered by payload. A listener that woke
    // for all of them would turn one busy scan into a thundering herd of
    // pointless range queries across every open stream.
    const store = new PostgresScanStore(writerDb.db, { bus: writerBus });
    const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });
    const options = ScanOptionsSchema.parse({ mode: 'deterministic' });
    const watched = await store.create({ target, options });
    const other = await store.create({ target, options });

    let wrongWakeups = 0;
    let rightWakeups = 0;
    const unwatch = await readerBus.subscribe(watched.id, () => {
      wrongWakeups += 1;
    });
    const unother = await readerBus.subscribe(other.id, () => {
      rightWakeups += 1;
    });

    await store.appendEvents(other.id, [
      ScanEventSchema.parse({
        scanId: other.id,
        seq: 0,
        ts: '2026-07-25T10:00:00.000Z',
        type: 'log',
        level: 'info',
        message: 'a different scan entirely',
      }),
    ]);

    await until(() => rightWakeups > 0, 'the notification for the other scan');
    expect(wrongWakeups).toBe(0);
    await unwatch();
    await unother();
  });

  it('stops waking a listener that has unsubscribed', async () => {
    const store = new PostgresScanStore(writerDb.db, { bus: writerBus });
    const scan = await store.create({
      target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
      options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    });

    let nudges = 0;
    const unsubscribe = await readerBus.subscribe(scan.id, () => {
      nudges += 1;
    });
    await unsubscribe();

    await writerBus.notify(scan.id);
    // Give a real notification time to arrive if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(nudges).toBe(0);
  });
});
