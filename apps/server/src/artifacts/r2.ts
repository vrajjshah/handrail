import {
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { R2Config } from '../config.js';
import { ObjectNotFoundError, type ObjectStore } from './objects.js';

/**
 * Cloudflare R2, through its S3-compatible API.
 *
 * Two things about this deployment are load-bearing and neither is visible in
 * the SDK call:
 *
 * - **The bucket is private.** There is no public development URL and no custom
 *   domain in front of it. The only way to read an object is a signed URL this
 *   process mints, which is what makes "artifacts are served through signed,
 *   expiring URLs" a property of the storage rather than of our routing.
 * - **The bucket carries a 14-day expiration lifecycle rule.** Retention is
 *   Cloudflare's job; see `policy.ts` for why, and for the three ways the
 *   application is held to agreeing with it.
 *
 * `region: 'auto'` and path-style addressing are what R2 wants; the endpoint is
 * derived from the account id rather than configured, because a mismatched pair
 * fails with an opaque signature error.
 */
export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config, options: { client?: S3Client } = {}) {
    this.bucket = config.bucket;
    this.client =
      options.client ??
      new S3Client({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Re-writing a content-addressed key is how a re-scan touches an object
        // it has seen before, and it refreshes the lifecycle clock — the object
        // and its `expires_at` row move together.
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (bytes === undefined) throw new ObjectNotFoundError(key);
      return Buffer.from(bytes);
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  /**
   * A presigned GET, good for `expiresInSeconds` and no longer.
   *
   * The response-header overrides matter: without them the browser is told
   * whatever R2 stored, and a lightbox showing an evidence screenshot needs an
   * accurate `image/png`. `private` on the cache directive keeps a shared proxy
   * from holding a picture of somebody's inbox, and the max-age matches the
   * signature's own life so nothing caches a URL past the point it 403s.
   */
  async signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined> {
    if (expiresInSeconds <= 0) return undefined;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: 'image/png',
        ResponseContentDisposition: 'inline',
        ResponseCacheControl: `private, max-age=${String(expiresInSeconds)}`,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** The bucket exists and these credentials can reach it. Used by `/readyz`. */
  async head(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** The underlying client, for the credential-gated `*.r2.test.ts` suite. */
  get s3(): S3Client {
    return this.client;
  }

  get bucketName(): string {
    return this.bucket;
  }
}

/**
 * A miss, however the SDK chose to spell it.
 *
 * `GetObject` on a missing key raises `NoSuchKey`, but a bucket the credentials
 * cannot list raises a bare 404 `NotFound` instead, and both mean the same
 * thing to a caller. Matching on the status as well as the class is what stops
 * a missing screenshot from surfacing as a 500.
 */
function isMissing(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  return status === 404;
}
