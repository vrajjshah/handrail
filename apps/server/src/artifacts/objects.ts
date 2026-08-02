/**
 * The object-storage port.
 *
 * Keys and bytes, nothing else — no artifact ids, no retention, no scan. Those
 * live in {@link ../artifacts/catalog.js} and {@link ../artifacts/policy.js},
 * which is what lets the whole serving path be tested without a network and
 * lets R2 be swapped for anything S3-shaped without touching a route.
 */
export interface ObjectStore {
  /** Idempotent: keys are content-addressed, so re-writing one is a no-op in effect. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /**
   * A URL that carries its own authorisation and stops working when it expires,
   * or `undefined` when this store cannot mint one.
   *
   * Not optional as a *method*, deliberately. Every implementation has to
   * answer the question, and the answer is visible at the call site instead of
   * hidden behind a capability check nobody remembers to write.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined>;
}

/** Thrown when a key holds nothing. The catalog turns this into a 404. */
export class ObjectNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`no object at ${key}`);
    this.name = 'ObjectNotFoundError';
    this.key = key;
  }
}

/**
 * An in-memory {@link ObjectStore}.
 *
 * The real implementation for a developer's machine and for every test that is
 * not about R2 itself. It cannot sign, and says so by returning `undefined` —
 * which is exactly the branch the artifact route has to handle anyway, so the
 * unsigned path is exercised by default rather than by exception.
 */
export class MemoryObjectStore implements ObjectStore {
  private readonly items = new Map<string, Buffer>();

  put(key: string, bytes: Buffer, _contentType?: string): Promise<void> {
    this.items.set(key, bytes);
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const bytes = this.items.get(key);
    if (bytes === undefined) return Promise.reject(new ObjectNotFoundError(key));
    return Promise.resolve(bytes);
  }

  // The full signature, even though nothing here reads it, so a signing
  // subclass in the test suite is a real override rather than a widening one.
  signedUrl(_key: string, _expiresInSeconds: number): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  get size(): number {
    return this.items.size;
  }
}
