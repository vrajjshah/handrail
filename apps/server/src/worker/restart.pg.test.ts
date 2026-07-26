import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  StateCaptureSchema,
  type AxeDetectionResult,
  type HeuristicResult,
  type StateCapture,
} from '@handrail/engine';
import {
  closeCheckpointer,
  createPostgresCheckpointer,
  setUpCheckpointer,
  type ScanCheckpointer,
  type ScanDriver,
} from '@handrail/orchestrator';
import { ScanOptionsSchema, ScanTargetSchema } from '@handrail/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connect, runMigrations, type DatabaseHandle } from '../db/client.js';
import { PostgresScanStore } from '../store/postgres.js';
import { runScanJob } from './run-scan-job.js';

const DATABASE_URL = process.env.DATABASE_URL;

const CAPTURE_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/engine/src/judge/__fixtures__/seeded-demo-desktop.capture.json',
);

/**
 * #18's acceptance criterion: **a scan survives a worker restart mid-run and
 * resumes from its checkpoint.**
 *
 * The two halves are tested separately elsewhere — the orchestrator proves a
 * checkpointed graph skips completed nodes, and `postgres.pg.test.ts` proves
 * the store outlives a connection. This is the whole claim: a job that dies
 * inside a real Postgres-backed run is picked up by a second worker, with
 * fresh objects throughout, and does not repeat the work it already paid for.
 */
describe.skipIf(DATABASE_URL === undefined)('a worker restart mid-scan', () => {
  let database: DatabaseHandle;
  let checkpointer: ScanCheckpointer;
  let capture: StateCapture;

  beforeAll(async () => {
    capture = StateCaptureSchema.parse(JSON.parse(await readFile(CAPTURE_FIXTURE, 'utf8')));
    database = connect(DATABASE_URL ?? '', 3);
    await runMigrations(database.db);
    checkpointer = createPostgresCheckpointer(DATABASE_URL ?? '');
    await setUpCheckpointer(checkpointer);
  });

  afterAll(async () => {
    await closeCheckpointer(checkpointer);
    await database.close();
  });

  beforeEach(async () => {
    await database.db.execute(sql`truncate table scans cascade`);
  });

  /** A driver that counts what it was asked to do, and can die once. */
  function driver(dieOnAxe = false): ScanDriver & { captures: number; closed: boolean } {
    let fatal = dieOnAxe;
    return {
      captures: 0,
      closed: false,
      capture(): Promise<StateCapture> {
        this.captures += 1;
        return Promise.resolve(capture);
      },
      axe(): Promise<AxeDetectionResult> {
        if (fatal) {
          fatal = false;
          return Promise.reject(new Error('worker terminated'));
        }
        return Promise.resolve({ findings: [], passes: [], degradations: [], axeVersion: '4.12.1' });
      },
      heuristics(): Promise<HeuristicResult> {
        return Promise.resolve({ outcomes: [], degradations: [] });
      },
      release(): Promise<void> {
        return Promise.resolve();
      },
      dispose(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  it('resumes from its checkpoint instead of starting over', async () => {
    const store = new PostgresScanStore(database.db);
    const scan = await store.create({
      target: ScanTargetSchema.parse({
        kind: 'url',
        url: capture.url,
        viewports: [{ label: 'desktop', width: 1280, height: 800 }],
      }),
      options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    });

    // ── First worker: dies during `detect`.
    const firstDriver = driver(true);
    await expect(
      runScanJob(
        { scanId: scan.id },
        {
          store,
          createDriver: () =>
            Promise.resolve({ driver: firstDriver, close: () => Promise.resolve() }),
          checkpointer,
          toolVersion: '9.9.9-test',
          flushEvery: 1,
        },
      ),
    ).rejects.toThrow(/worker terminated/);

    expect(firstDriver.captures).toBe(1);
    const afterCrash = await store.get(scan.id);
    expect(afterCrash?.record.status).toBe('failed');
    const seqAtCrash = await store.lastSeq(scan.id);
    expect(seqAtCrash).toBeGreaterThan(0);

    // ── Second worker: a different process would have different objects, so
    // this one gets a fresh store, a fresh pool and a fresh driver. Only the
    // database is shared, which is exactly the situation after a restart.
    const secondConnection = connect(DATABASE_URL ?? '', 1);
    const secondDriver = driver();
    try {
      const secondStore = new PostgresScanStore(secondConnection.db);
      const result = await runScanJob(
        { scanId: scan.id },
        {
          store: secondStore,
          createDriver: () =>
            Promise.resolve({ driver: secondDriver, close: () => Promise.resolve() }),
          checkpointer,
          toolVersion: '9.9.9-test',
          flushEvery: 1,
        },
      );

      expect(result.resumed).toBe(true);
      expect(result.status).toBe('completed');
      // The scan did not pay for the capture twice. This is the criterion.
      expect(secondDriver.captures).toBe(0);

      const finished = await secondStore.get(scan.id);
      expect(finished?.record.status).toBe('completed');
      expect(finished?.report).toBeDefined();
      expect(finished?.report?.coverage.criteriaTotal).toBe(55);
    } finally {
      await secondConnection.close();
    }

    // ── The event stream across both attempts is one unbroken sequence. `seq`
    // is the SSE event id, so a gap or a repeat here is a client being told it
    // saw something it never received.
    const events = await store.eventsSince(scan.id, -1);
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index));
    expect(events.at(-1)?.type).toBe('scan.completed');
  });

  it('starts over rather than claiming a resume when there is no checkpointer', async () => {
    const store = new PostgresScanStore(database.db);
    const scan = await store.create({
      target: ScanTargetSchema.parse({
        kind: 'url',
        url: capture.url,
        viewports: [{ label: 'desktop', width: 1280, height: 800 }],
      }),
      options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    });

    const first = driver(true);
    await expect(
      runScanJob(
        { scanId: scan.id },
        {
          store,
          createDriver: () => Promise.resolve({ driver: first, close: () => Promise.resolve() }),
          toolVersion: '9.9.9-test',
          flushEvery: 1,
        },
      ),
    ).rejects.toThrow();

    const second = driver();
    const result = await runScanJob(
      { scanId: scan.id },
      {
        store,
        createDriver: () => Promise.resolve({ driver: second, close: () => Promise.resolve() }),
        toolVersion: '9.9.9-test',
        flushEvery: 1,
      },
    );

    // No checkpointer, so nothing to resume from — and it says so rather than
    // reporting a resume it did not perform.
    expect(result.resumed).toBe(false);
    expect(second.captures).toBe(1);
  });
});
