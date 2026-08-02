import {
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { artifactId } from '@handrail/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig, r2ConfigFrom, type R2Config } from '../config.js';
import { ARTIFACT_KEY_PREFIX, ARTIFACT_RETENTION_DAYS, storageKeyFor } from './policy.js';
import { R2ObjectStore } from './r2.js';

/**
 * The half of #22 that only a real bucket can answer.
 *
 *     R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
 *       pnpm test:r2
 *
 * **Not a CI check, on purpose.** CI holds no cloud credentials, for the same
 * reason it holds no model API key. Everything that can be proven without a
 * bucket is proven in `artifacts.test.ts`; what is left here are the three
 * claims that are about Cloudflare rather than about our code — that a signed
 * URL works, that an unsigned one does not, and that the bucket's own retention
 * rule is the number this application believes it is.
 */
let r2: R2Config | undefined;
try {
  r2 = r2ConfigFrom(loadConfig());
} catch {
  // A half-configured environment is a skip here, not a failure: `config.test.ts`
  // already owns the claim that a partial set is rejected at boot.
  r2 = undefined;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// A key nothing else will collide with, under the prefix the lifecycle rule
// targets, so the test object is subject to exactly the policy under test.
const TEST_ID = artifactId(`test_${Date.now().toString(16)}`);
const KEY = storageKeyFor(TEST_ID);

describe.skipIf(r2 === undefined)('R2ObjectStore against a real bucket', () => {
  let store: R2ObjectStore;

  beforeAll(() => {
    // Narrowed rather than asserted: `describe.skipIf` has already decided this
    // block does not run without credentials, and a cast would hide it if the
    // two ever disagreed.
    if (r2 === undefined) throw new Error('unreachable: skipIf guards this suite');
    store = new R2ObjectStore(r2);
  });

  afterAll(async () => {
    // The lifecycle rule would get there eventually; leaving fourteen days of
    // test objects in a bucket that also holds real screenshots is untidy.
    await store.s3.send(new DeleteObjectCommand({ Bucket: store.bucketName, Key: KEY }));
  });

  it('reaches the bucket, which is what /readyz asks it', async () => {
    await expect(store.head()).resolves.toBeUndefined();
  });

  it('round-trips bytes', async () => {
    await store.put(KEY, PNG, 'image/png');
    expect((await store.get(KEY)).equals(PNG)).toBe(true);
  });

  it('is missing, not broken, for a key it does not hold', async () => {
    await expect(store.get(`${ARTIFACT_KEY_PREFIX}nothing_here.png`)).rejects.toThrow(
      /no object at/,
    );
  });

  it('serves the bytes through a signed URL, and refuses an unsigned one', async () => {
    // The acceptance clause, end to end: the bucket is private, and the only
    // way in is a capability this process minted.
    await store.put(KEY, PNG, 'image/png');
    const url = await store.signedUrl(KEY, 300);
    expect(url).toBeDefined();

    const signed = await fetch(url ?? '');
    expect(signed.status).toBe(200);
    expect(signed.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await signed.arrayBuffer()).equals(PNG)).toBe(true);

    const unsigned = await fetch((url ?? '').split('?')[0] ?? '');
    expect(
      unsigned.status,
      'the bucket answered an unsigned GET — it is not private',
    ).toBeGreaterThanOrEqual(400);
  });

  it('mints a URL that stops working', async () => {
    // "Expiring" is the word in the acceptance criterion, and the only honest
    // way to check it is to wait for one.
    await store.put(KEY, PNG, 'image/png');
    const url = await store.signedUrl(KEY, 1);
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const response = await fetch(url ?? '');
    expect(response.status, 'an expired signature was still accepted').toBeGreaterThanOrEqual(400);
  });

  it('refuses to sign at all for a window that has already closed', async () => {
    expect(await store.signedUrl(KEY, 0)).toBeUndefined();
  });

  /**
   * The assertion this suite exists for.
   *
   * Retention is enforced by the bucket, not by us — but an application whose
   * `expires_at` says fourteen days against a bucket set to ninety is a privacy
   * promise nobody is keeping. This is the check that notices.
   */
  it('agrees with the bucket about how long a screenshot lives', async () => {
    const configuration = await store.s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: store.bucketName }),
    );
    const rules: LifecycleRule[] = configuration.Rules ?? [];

    const applicable = rules.filter(
      (rule) => rule.Status === 'Enabled' && coversArtifacts(rule),
    );
    expect(
      applicable,
      `no enabled lifecycle rule covers "${ARTIFACT_KEY_PREFIX}" on bucket ` +
        `${store.bucketName}. Retention is the bucket's job; without a rule, screenshots ` +
        'are kept forever. Rules found: ' +
        JSON.stringify(rules),
    ).not.toHaveLength(0);

    const days = applicable.map((rule) => rule.Expiration?.Days);
    expect(
      days,
      `the bucket expires artifacts after ${JSON.stringify(days)} day(s), but ` +
        `ARTIFACT_RETENTION_DAYS is ${String(ARTIFACT_RETENTION_DAYS)}. Change one to match ` +
        'the other — the application and the policy have parted company.',
    ).toContain(ARTIFACT_RETENTION_DAYS);
  });
});

/** A rule with no prefix covers everything; otherwise it has to reach our keys. */
function coversArtifacts(rule: LifecycleRule): boolean {
  const prefix = rule.Filter?.Prefix ?? rule.Prefix ?? '';
  return prefix === '' || ARTIFACT_KEY_PREFIX.startsWith(prefix);
}
