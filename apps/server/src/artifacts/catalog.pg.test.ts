import {
  ScanOptionsSchema,
  ScanTargetSchema,
  artifactId,
  type ScanId,
} from '@handrail/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connect, runMigrations, type DatabaseHandle } from '../db/client.js';
import { PostgresScanStore } from '../store/postgres.js';
import { MemoryObjectStore } from './objects.js';
import { PostgresArtifactCatalog } from './postgres-catalog.js';
import { expiresAtFor, storageKeyFor } from './policy.js';
import { ScanArtifactStore } from './store.js';

/**
 * The `artifacts` table, against a real Postgres.
 *
 * #18 created this table and nothing ever wrote to it; #22 is what puts rows in
 * it. Two things need a real database rather than the in-memory catalog: the
 * `greatest(...)` upsert, which is SQL and cannot be checked anywhere else, and
 * the foreign key to `scans`, which is what stops an artifact outliving the
 * scan that explains it.
 *
 * No R2 credentials here, deliberately. The object store is in memory; what is
 * under test is the catalog. The credential-gated half lives in `*.r2.test.ts`.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const CAPTURED = new Date('2026-08-01T00:00:00.000Z');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe.skipIf(DATABASE_URL === undefined)('PostgresArtifactCatalog', () => {
  let database: DatabaseHandle;
  let catalog: PostgresArtifactCatalog;
  let scans: PostgresScanStore;

  beforeAll(async () => {
    database = connect(DATABASE_URL ?? '', 2);
    await runMigrations(database.db);
    catalog = new PostgresArtifactCatalog(database.db);
    scans = new PostgresScanStore(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.db.execute(sql`truncate table scans cascade`);
  });

  async function newScan(): Promise<ScanId> {
    const scan = await scans.create({
      target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
      options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    });
    return scan.id;
  }

  it('writes a row a scan can be traced back from', async () => {
    const scanId = await newScan();
    const objects = new MemoryObjectStore();
    const store = new ScanArtifactStore({ scanId, objects, catalog, now: () => CAPTURED });

    const id = await store.put(PNG, 'full');
    const row = await catalog.get(id);

    expect(row).toMatchObject({
      scanId,
      kind: 'full',
      contentType: 'image/png',
      byteSize: PNG.byteLength,
      storageKey: storageKeyFor(id),
    });
    expect(row?.expiresAt.toISOString()).toBe(expiresAtFor(CAPTURED).toISOString());
  });

  it('moves an expiry forward on a repeat, and never backwards', async () => {
    // The SQL half of the rule the in-memory catalog implements in TypeScript.
    // `greatest(...)` is the whole reason this test needs a database.
    const scanId = await newScan();
    const row = {
      id: artifactId('full_a1b2c3d4'),
      scanId,
      kind: 'full',
      contentType: 'image/png',
      byteSize: 8,
      storageKey: 'artifacts/full_a1b2c3d4.png',
      createdAt: CAPTURED,
      expiresAt: expiresAtFor(CAPTURED),
    };

    await catalog.record(row);
    await catalog.record({ ...row, expiresAt: new Date('2026-08-20T00:00:00.000Z') });
    expect((await catalog.get(row.id))?.expiresAt.toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );

    await catalog.record({ ...row, expiresAt: new Date('2026-08-02T00:00:00.000Z') });
    expect((await catalog.get(row.id))?.expiresAt.toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );
  });

  it('survives a resumed worker re-capturing the same page', async () => {
    // Ids are content-derived, so a retried job writes the same rows again.
    // That has to be harmless rather than a primary-key violation, the same
    // way `appendEvents` and `saveFindings` already are.
    const scanId = await newScan();
    const objects = new MemoryObjectStore();
    const store = new ScanArtifactStore({ scanId, objects, catalog, now: () => CAPTURED });

    const first = await store.put(PNG, 'full');
    const second = await store.put(PNG, 'full');
    expect(second).toBe(first);

    const [count] = await database.db.execute<{ n: number }>(
      sql`select count(*)::int as n from artifacts`,
    ).then((result) => result.rows);
    expect(count?.n).toBe(1);
  });

  it('has nothing for an id it never recorded', async () => {
    expect(await catalog.get(artifactId('full_deadbeef'))).toBeUndefined();
  });

  it('lets a deleted scan take its artifacts with it', async () => {
    // The foreign key from #18's migration, doing its job: a screenshot that
    // outlived the scan explaining it would be personal data nothing points at.
    const scanId = await newScan();
    const objects = new MemoryObjectStore();
    const id = await new ScanArtifactStore({ scanId, objects, catalog }).put(PNG, 'full');
    expect(await catalog.get(id)).toBeDefined();

    await database.db.execute(sql`delete from scans where id = ${scanId}`);
    expect(await catalog.get(id)).toBeUndefined();
  });
});
