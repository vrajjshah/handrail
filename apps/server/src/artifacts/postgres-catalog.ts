import { artifactId as toArtifactId, scanId as toScanId, type ArtifactId } from '@handrail/schemas';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { artifacts } from '../db/schema.js';
import type { ArtifactCatalog, ArtifactRecord } from './catalog.js';

/**
 * The durable {@link ArtifactCatalog} — #18's `artifacts` table, finally used.
 *
 * Same contract as the in-memory one, and the two are held to the same
 * expectations in `artifacts.test.ts` and `catalog.pg.test.ts` — the upsert
 * rule is the sort of thing that is easy to state and easy to implement
 * differently twice.
 */
export class PostgresArtifactCatalog implements ArtifactCatalog {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async record(entry: ArtifactRecord): Promise<void> {
    await this.db
      .insert(artifacts)
      .values({
        id: entry.id,
        scanId: entry.scanId,
        kind: entry.kind,
        contentType: entry.contentType,
        byteSize: entry.byteSize,
        storageKey: entry.storageKey,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      })
      // `greatest`, not "last write wins". Re-writing the object refreshed the
      // bucket's lifecycle clock, so the row's expiry has to move forward with
      // it — moving it *backwards* would have the API refuse an artifact that
      // is still sitting in the bucket.
      .onConflictDoUpdate({
        target: artifacts.id,
        set: { expiresAt: sql`greatest(${artifacts.expiresAt}, excluded.expires_at)` },
      });
  }

  async get(id: ArtifactId): Promise<ArtifactRecord | undefined> {
    const [row] = await this.db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    if (row === undefined) return undefined;
    return {
      id: toArtifactId(row.id),
      scanId: toScanId(row.scanId),
      kind: row.kind,
      contentType: row.contentType,
      byteSize: row.byteSize,
      storageKey: row.storageKey,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}
