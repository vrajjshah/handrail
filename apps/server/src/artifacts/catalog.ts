import type { ArtifactId, ScanId } from '@handrail/schemas';

/**
 * What the `artifacts` table holds: a pointer to the bytes, and the clock.
 *
 * The bytes are never in Postgres. This row is how the API finds them, how it
 * knows when to stop serving them, and how anyone auditing the deployment can
 * answer "what personal data is this holding, and until when" without listing a
 * bucket.
 */
export interface ArtifactRecord {
  id: ArtifactId;
  /** The scan that first produced these bytes. Ids are content-addressed, so a
   * later scan that captures an identical screenshot reuses this row. */
  scanId: ScanId;
  kind: string;
  contentType: string;
  byteSize: number;
  storageKey: string;
  createdAt: Date;
  /** `created_at + ARTIFACT_RETENTION_DAYS`. The app's copy of the bucket's rule. */
  expiresAt: Date;
}

export interface ArtifactCatalog {
  /**
   * Record an artifact, idempotently.
   *
   * Content-addressed ids mean the same artifact can be produced by a retried
   * worker, by a second viewport, or by a later scan of an unchanged page. A
   * repeat is not an error, and it **extends** `expires_at` rather than
   * shortening it: the write refreshed the object's own lifecycle clock, so the
   * row has to move with it or the two would disagree in the one direction that
   * matters — the API refusing to serve something that still exists.
   */
  record(entry: ArtifactRecord): Promise<void>;
  get(id: ArtifactId): Promise<ArtifactRecord | undefined>;
}

/** An in-memory {@link ArtifactCatalog}, for tests and for a database-less server. */
export class MemoryArtifactCatalog implements ArtifactCatalog {
  private readonly rows = new Map<string, ArtifactRecord>();

  record(entry: ArtifactRecord): Promise<void> {
    const existing = this.rows.get(entry.id);
    this.rows.set(
      entry.id,
      existing === undefined
        ? entry
        : // Same rule as the Postgres upsert's `greatest(...)`: keep the first
          // producer, take the later expiry. Stated twice because these are two
          // implementations of one contract — `artifacts.test.ts` holds this one
          // to it and `catalog.pg.test.ts` holds the other.
          { ...existing, expiresAt: laterOf(existing.expiresAt, entry.expiresAt) },
    );
    return Promise.resolve();
  }

  get(id: ArtifactId): Promise<ArtifactRecord | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  get size(): number {
    return this.rows.size;
  }
}

export function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
