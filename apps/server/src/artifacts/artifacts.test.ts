import { contentAddressedId } from '@handrail/engine';
import { artifactId, scanId as toScanId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { SigningObjectStore } from '../__test__/signing-object-store.js';
import { ArtifactExpiredError, ArtifactNotFoundError } from '../store/types.js';
import { MemoryArtifactCatalog, type ArtifactCatalog } from './catalog.js';
import { MemoryObjectStore, ObjectNotFoundError, type ObjectStore } from './objects.js';
import {
  ARTIFACT_KEY_PREFIX,
  ARTIFACT_RETENTION_DAYS,
  SIGNED_URL_TTL_SECONDS,
  expiresAtFor,
  signedUrlTtlFor,
  storageKeyFor,
} from './policy.js';
import { CatalogArtifactReader, ScanArtifactStore } from './store.js';

const SCAN = toScanId('scan_1');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const OTHER = Buffer.from('89504e470d0a1a0aff', 'hex');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('the retention policy', () => {
  it('is 14 days, which is the number the bucket lifecycle rule carries', () => {
    // The bucket enforces retention; this constant is the application agreeing
    // with it. `pnpm test:r2` reads the real rule and fails when the two part
    // company — this test is the half that runs without credentials.
    expect(ARTIFACT_RETENTION_DAYS).toBe(14);
  });

  it('expires an artifact 14 days after it was captured', () => {
    const created = new Date('2026-08-01T12:00:00.000Z');
    expect(expiresAtFor(created).toISOString()).toBe('2026-08-15T12:00:00.000Z');
  });

  it('keys every artifact under the prefix the lifecycle rule targets', () => {
    // A key written outside `artifacts/` is a screenshot the rule never
    // deletes, which is the one way this design leaks personal data.
    const key = storageKeyFor(artifactId('full_a1b2c3d4'));
    expect(key.startsWith(ARTIFACT_KEY_PREFIX)).toBe(true);
    expect(key).toBe('artifacts/full_a1b2c3d4.png');
  });

  it('signs for the full window when there is plenty of life left', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const expires = new Date(now.getTime() + 10 * DAY_MS);
    expect(signedUrlTtlFor(expires, now)).toBe(SIGNED_URL_TTL_SECONDS);
  });

  it('never signs a URL that would outlive the artifact', () => {
    // A five-minute capability minted one minute before expiry would be
    // readable for four minutes after the deployment promised the bytes were
    // gone. Clamped, so the URL dies with the object.
    const now = new Date('2026-08-01T00:00:00.000Z');
    const expires = new Date(now.getTime() + 60_000);
    expect(signedUrlTtlFor(expires, now)).toBe(60);
  });

  it('refuses to sign at all once the window has closed', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(signedUrlTtlFor(new Date(now.getTime() - 1), now)).toBeLessThanOrEqual(0);
  });
});

describe.each<[string, () => ArtifactCatalog]>([
  ['MemoryArtifactCatalog', () => new MemoryArtifactCatalog()],
])('%s', (_name, make) => {
  const row = (over: { expiresAt?: Date } = {}) => ({
    id: artifactId('full_a1b2c3d4'),
    scanId: SCAN,
    kind: 'full',
    contentType: 'image/png',
    byteSize: 8,
    storageKey: 'artifacts/full_a1b2c3d4.png',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date('2026-08-15T00:00:00.000Z'),
    ...over,
  });

  it('round-trips a record', async () => {
    const catalog = make();
    await catalog.record(row());
    expect((await catalog.get(artifactId('full_a1b2c3d4')))?.byteSize).toBe(8);
  });

  it('has nothing for an id it never saw', async () => {
    expect(await make().get(artifactId('full_deadbeef'))).toBeUndefined();
  });

  it('takes the later expiry when the same artifact is recorded twice', async () => {
    // A retried worker, a second viewport, or a later scan of an unchanged
    // page all re-write the same content-addressed key — which refreshes the
    // bucket's own lifecycle clock. The row has to move with it.
    const catalog = make();
    await catalog.record(row());
    await catalog.record(row({ expiresAt: new Date('2026-08-20T00:00:00.000Z') }));
    expect((await catalog.get(artifactId('full_a1b2c3d4')))?.expiresAt.toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );
  });

  it('never moves an expiry backwards', async () => {
    // The dangerous direction: the API would refuse an artifact still sitting
    // in the bucket, and the report would show a hole nothing explains.
    const catalog = make();
    await catalog.record(row());
    await catalog.record(row({ expiresAt: new Date('2026-08-02T00:00:00.000Z') }));
    expect((await catalog.get(artifactId('full_a1b2c3d4')))?.expiresAt.toISOString()).toBe(
      '2026-08-15T00:00:00.000Z',
    );
  });
});

describe('ScanArtifactStore', () => {
  function build(now = new Date('2026-08-01T00:00:00.000Z')) {
    const objects = new MemoryObjectStore();
    const catalog = new MemoryArtifactCatalog();
    const store = new ScanArtifactStore({ scanId: SCAN, objects, catalog, now: () => now });
    return { objects, catalog, store, now };
  }

  it('writes the bytes and the row, and answers with the content-addressed id', async () => {
    const { objects, catalog, store } = build();
    const id = await store.put(PNG, 'full');

    expect(id).toBe(contentAddressedId(PNG, 'full'));
    const record = await catalog.get(id);
    expect(record).toMatchObject({
      scanId: SCAN,
      kind: 'full',
      contentType: 'image/png',
      byteSize: PNG.byteLength,
      storageKey: storageKeyFor(id),
    });
    expect((await objects.get(storageKeyFor(id))).equals(PNG)).toBe(true);
  });

  it('stamps expires_at at exactly the retention window', async () => {
    const { catalog, store } = build();
    const id = await store.put(PNG, 'full');
    const record = await catalog.get(id);
    expect(record?.expiresAt.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('stores identical bytes once, however many times they are captured', async () => {
    // Content-addressing is what makes a retried worker harmless: the second
    // write lands on the same key with the same content.
    const { objects, catalog, store } = build();
    await store.put(PNG, 'full');
    await store.put(PNG, 'full');
    await store.put(OTHER, 'view');
    expect(objects.size).toBe(2);
    expect(catalog.size).toBe(2);
  });

  it('does not record a row when the bytes never landed', async () => {
    // The other order would leave the report pointing at objects that do not
    // exist, which is worse than a report that admits it has no evidence.
    const objects: ObjectStore = {
      put: () => Promise.reject(new Error('r2 is having a day')),
      get: () => Promise.reject(new ObjectNotFoundError('x')),
      signedUrl: () => Promise.resolve(undefined),
    };
    const catalog = new MemoryArtifactCatalog();
    const store = new ScanArtifactStore({ scanId: SCAN, objects, catalog });

    await expect(store.put(PNG, 'full')).rejects.toThrow('r2 is having a day');
    expect(catalog.size).toBe(0);
  });

  it('reads back what it wrote', async () => {
    const { store } = build();
    const id = await store.put(PNG, 'full');
    expect((await store.get(id)).equals(PNG)).toBe(true);
  });
});

describe('CatalogArtifactReader', () => {
  async function build(options: { signing?: boolean; now?: Date } = {}) {
    const objects = options.signing === true ? new SigningObjectStore() : new MemoryObjectStore();
    const catalog = new MemoryArtifactCatalog();
    const written = new ScanArtifactStore({
      scanId: SCAN,
      objects,
      catalog,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });
    const id = await written.put(PNG, 'full');

    const now = options.now ?? new Date('2026-08-02T00:00:00.000Z');
    const reader = new CatalogArtifactReader({ objects, catalog, now: () => now });
    return { objects, catalog, reader, id };
  }

  it('serves the bytes inside the retention window', async () => {
    const { reader, id } = await build();
    expect((await reader.get(id)).equals(PNG)).toBe(true);
  });

  it('mints a signed URL for the artifact’s own key', async () => {
    const { objects, reader, id } = await build({ signing: true });
    const url = await reader.signedUrl(id);
    expect(url).toContain('artifacts/');
    expect(url).toContain('X-Amz-Signature');
    expect((objects as SigningObjectStore).signed[0]?.key).toBe(storageKeyFor(id));
  });

  it('signs for no longer than the window, and no longer than the artifact has left', async () => {
    const { objects, reader, id } = await build({ signing: true });
    await reader.signedUrl(id);
    expect((objects as SigningObjectStore).signed[0]?.ttl).toBe(SIGNED_URL_TTL_SECONDS);

    // One minute before the artifact expires, the capability is one minute long.
    const nearly = new SigningObjectStore();
    const catalog = new MemoryArtifactCatalog();
    const written = new ScanArtifactStore({
      scanId: SCAN,
      objects: nearly,
      catalog,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });
    const same = await written.put(PNG, 'full');
    const reader2 = new CatalogArtifactReader({
      objects: nearly,
      catalog,
      now: () => new Date('2026-08-14T23:59:00.000Z'),
    });
    await reader2.signedUrl(same);
    expect(nearly.signed.at(-1)?.ttl).toBe(60);
  });

  it('says undefined when the store cannot sign, rather than pretending', async () => {
    const { reader, id } = await build();
    expect(await reader.signedUrl(id)).toBeUndefined();
  });

  it('refuses both bytes and a URL once the window has closed', async () => {
    // Enforced by the application at the moment the policy says so, rather than
    // waiting for Cloudflare to get round to the delete. A lifecycle rule
    // someone removed cannot quietly extend retention in practice.
    const { reader, id } = await build({
      signing: true,
      now: new Date('2026-08-15T00:00:01.000Z'),
    });
    await expect(reader.get(id)).rejects.toBeInstanceOf(ArtifactExpiredError);
    await expect(reader.signedUrl(id)).rejects.toBeInstanceOf(ArtifactExpiredError);
  });

  it('is a miss, not a fault, when the bucket got there first', async () => {
    // The row survives a few seconds longer than the object at the very end of
    // an artifact's life. That race is lost harmlessly.
    const { objects, catalog, id } = await build();
    const record = await catalog.get(id);
    expect(record).toBeDefined();
    const emptied = new CatalogArtifactReader({
      objects: {
        put: () => Promise.resolve(),
        get: (key) => Promise.reject(new ObjectNotFoundError(key)),
        signedUrl: () => Promise.resolve(undefined),
      },
      catalog,
      now: () => new Date('2026-08-02T00:00:00.000Z'),
    });
    expect(objects.size).toBe(1);
    await expect(emptied.get(id)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('does not know an id it has no row for', async () => {
    const { reader } = await build({ signing: true });
    const unknown = artifactId('full_deadbeef');
    await expect(reader.get(unknown)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(reader.signedUrl(unknown)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
