import type { ArtifactId } from '@handrail/schemas';

/**
 * The retention policy, as numbers.
 *
 * **The bucket enforces retention; this file agrees with it.** A 14-day
 * expiration lifecycle rule on the `artifacts/` prefix is what actually deletes
 * a screenshot — set once in Cloudflare, applied by Cloudflare, and still
 * applied if this process is dead, mis-deployed or rolled back to a version
 * that never heard of retention. An application that swept its own bucket would
 * be a promise; a lifecycle rule is a policy.
 *
 * What the application owes in return is *agreement*. Three things hold it:
 *
 * 1. `expires_at` on every `artifacts` row is `created_at + ARTIFACT_RETENTION_DAYS`,
 *    so the database says the same thing the bucket will do.
 * 2. The API stops serving an artifact the moment its `expires_at` passes,
 *    rather than waiting for the object to disappear. A lifecycle rule someone
 *    deleted cannot quietly extend retention in practice.
 * 3. `pnpm test:r2` reads the bucket's real lifecycle configuration and fails
 *    when it does not match {@link ARTIFACT_RETENTION_DAYS}. That suite needs
 *    credentials, so it is not a CI check — it is the thing to run after
 *    touching the bucket.
 */
export const ARTIFACT_RETENTION_DAYS = 14;

/** The prefix the lifecycle rule targets. Everything we write lives under it. */
export const ARTIFACT_KEY_PREFIX = 'artifacts/';

/**
 * How long a signed URL lives.
 *
 * Five minutes: long enough to load a report page over a bad connection, short
 * enough that a URL pasted into a ticket, a chat or a proxy log is worthless by
 * the time anyone reads it. A signed URL is a bearer capability for pixels that
 * may show someone's inbox — the shortest workable life is the right one.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an artifact created at `createdAt` stops being served, and stops existing. */
export function expiresAtFor(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ARTIFACT_RETENTION_DAYS * DAY_MS);
}

/**
 * Where an artifact's bytes live.
 *
 * Content-addressed and *not* namespaced by scan. Ids are `<kind>_<sha256
 * prefix>`, so the same bytes always land on the same key: a re-scan of an
 * unchanged page overwrites rather than duplicates, and the write is idempotent
 * — which is what makes a retried worker harmless. The `artifacts` row records
 * which scan first produced it.
 */
export function storageKeyFor(id: ArtifactId): string {
  return `${ARTIFACT_KEY_PREFIX}${id}.png`;
}

/**
 * How long a URL for this artifact may be signed for.
 *
 * Clamped to whatever life the artifact has left, so a URL can never outlive
 * the retention boundary — a five-minute capability minted four minutes before
 * expiry dies with the object, not a minute after it. Zero or less means the
 * artifact is already gone and no URL should be minted at all.
 */
export function signedUrlTtlFor(expiresAt: Date, now: Date): number {
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.min(SIGNED_URL_TTL_SECONDS, remaining);
}
