import { MemoryObjectStore } from '../artifacts/objects.js';

/**
 * An in-memory object store that can mint URLs.
 *
 * The redirect branch of `/api/artifacts/:id` is the one #22 exists for, and it
 * must be covered by the suite everybody runs — not only by the credential-
 * gated `*.r2.test.ts` files. The URL shape mirrors a real presigned R2 one
 * closely enough that the log scrubber's `X-Amz-Signature` match applies to it,
 * which is what lets a test assert the signature never reaches a log line.
 */
export class SigningObjectStore extends MemoryObjectStore {
  readonly signed: { key: string; ttl: number }[] = [];

  override signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined> {
    this.signed.push({ key, ttl: expiresInSeconds });
    return Promise.resolve(
      `https://acct.r2.cloudflarestorage.com/bucket/${key}` +
        `?X-Amz-Expires=${String(expiresInSeconds)}&X-Amz-Signature=deadbeefcafe`,
    );
  }
}
