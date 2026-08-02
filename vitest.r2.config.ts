import { defineConfig } from 'vitest/config';

/**
 * Integration suites that need a real R2 bucket.
 *
 * `pnpm test:r2`, with the four `R2_*` variables set. **This is not a CI job
 * and must never become one.** CI holds no cloud credentials — that is the same
 * rule that keeps model providers out of it — so everything R2-shaped that can
 * be checked without a bucket is checked in `artifacts.test.ts` against the
 * in-memory object store, and only the claims that are genuinely *about
 * Cloudflare* live here:
 *
 * - a signed URL actually fetches the bytes, and an unsigned one does not;
 * - a signed URL stops working when it expires;
 * - **the bucket's lifecycle rule matches `ARTIFACT_RETENTION_DAYS`** — the one
 *   assertion that can tell you the application and the policy have parted
 *   company, which is what #22's acceptance asks for.
 *
 * Run it after touching the bucket, the retention constant, or the R2 client.
 * Each file `describe.skipIf`s itself without credentials, so running this
 * config with none is a no-op rather than a wall of red.
 */
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.r2.test.ts', 'packages/*/src/**/*.r2.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Round trips over the network, and one test deliberately waits for a
    // signature to expire.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One bucket, shared: parallel files writing the same keys would delete
    // each other's objects in teardown.
    fileParallelism: false,
  },
});
