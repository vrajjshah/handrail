import { contentAddressedId, type ArtifactStore } from '@handrail/engine';
import type { ArtifactId, ScanId } from '@handrail/schemas';

import { ArtifactExpiredError, ArtifactNotFoundError, type ArtifactReader } from '../store/types.js';
import type { ArtifactCatalog } from './catalog.js';
import { ObjectNotFoundError, type ObjectStore } from './objects.js';
import { expiresAtFor, signedUrlTtlFor, storageKeyFor } from './policy.js';

const PNG = 'image/png';

export interface ScanArtifactStoreOptions {
  scanId: ScanId;
  objects: ObjectStore;
  catalog: ArtifactCatalog;
  now?: () => Date;
}

/**
 * The store a scan writes screenshots into — `@handrail/engine`'s
 * `ArtifactStore`, backed by an object store and a catalog row.
 *
 * Built per scan, because the row needs to say which scan produced it and
 * because a store that outlived a job would be one more thing to remember to
 * close. The engine's capture path already treats a failing `put` as a
 * degradation rather than a scan failure, so an object store that is briefly
 * unreachable costs the report its evidence images and says so — it does not
 * lose the scan.
 */
export class ScanArtifactStore implements ArtifactStore {
  private readonly scanId: ScanId;
  private readonly objects: ObjectStore;
  private readonly catalog: ArtifactCatalog;
  private readonly now: () => Date;

  constructor(options: ScanArtifactStoreOptions) {
    this.scanId = options.scanId;
    this.objects = options.objects;
    this.catalog = options.catalog;
    this.now = options.now ?? (() => new Date());
  }

  async put(bytes: Buffer, kind: string): Promise<ArtifactId> {
    const id = contentAddressedId(bytes, kind);
    const key = storageKeyFor(id);
    const createdAt = this.now();

    // Bytes first, row second. The other order would leave a row promising an
    // object that does not exist, and a report full of 404s is worse than a
    // report that admits it has no evidence images.
    await this.objects.put(key, bytes, PNG);
    await this.catalog.record({
      id,
      scanId: this.scanId,
      kind,
      contentType: PNG,
      byteSize: bytes.byteLength,
      storageKey: key,
      createdAt,
      expiresAt: expiresAtFor(createdAt),
    });

    return id;
  }

  get(id: ArtifactId): Promise<Buffer> {
    return readBytes(this.catalog, this.objects, id, this.now());
  }
}

export interface CatalogArtifactReaderOptions {
  objects: ObjectStore;
  catalog: ArtifactCatalog;
  now?: () => Date;
}

/**
 * The API's side of the same storage: read the bytes, or mint a URL for them.
 *
 * The expiry check lives here rather than in the route, because both ways of
 * getting at an artifact have to honour it. Retention that only applied to the
 * path someone remembered to guard would not be a policy.
 */
export class CatalogArtifactReader implements ArtifactReader {
  private readonly objects: ObjectStore;
  private readonly catalog: ArtifactCatalog;
  private readonly now: () => Date;

  constructor(options: CatalogArtifactReaderOptions) {
    this.objects = options.objects;
    this.catalog = options.catalog;
    this.now = options.now ?? (() => new Date());
  }

  get(id: ArtifactId): Promise<Buffer> {
    return readBytes(this.catalog, this.objects, id, this.now());
  }

  async signedUrl(id: ArtifactId): Promise<string | undefined> {
    const record = await this.catalog.get(id);
    if (record === undefined) throw new ArtifactNotFoundError(id);

    const ttl = signedUrlTtlFor(record.expiresAt, this.now());
    // Not "expired enough to still be there": past `expires_at` the deployment
    // has stopped promising this exists, so it stops handing out capabilities
    // for it — whatever the bucket happens to have got round to deleting.
    if (ttl <= 0) throw new ArtifactExpiredError(id, record.expiresAt);

    return this.objects.signedUrl(record.storageKey, ttl);
  }
}

async function readBytes(
  catalog: ArtifactCatalog,
  objects: ObjectStore,
  id: ArtifactId,
  now: Date,
): Promise<Buffer> {
  const record = await catalog.get(id);
  if (record === undefined) throw new ArtifactNotFoundError(id);
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new ArtifactExpiredError(id, record.expiresAt);
  }

  try {
    return await objects.get(record.storageKey);
  } catch (error) {
    // A row with no object is the bucket's lifecycle rule having reached it
    // first — a race we lose harmlessly, once, in the last seconds of an
    // artifact's life. It is a miss, not a fault.
    if (error instanceof ObjectNotFoundError) throw new ArtifactNotFoundError(id);
    throw error;
  }
}
