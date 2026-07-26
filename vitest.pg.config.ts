import { defineConfig } from 'vitest/config';

/**
 * Integration suites that need a real Postgres.
 *
 * `pnpm test:pg`, with `DATABASE_URL` set. They are excluded from the default
 * `unit` run for the same reason the browser suites are: the three-OS matrix
 * earns its keep by being fast and dependency-free, and a suite that needs a
 * database would either slow it down or quietly skip on two of the three.
 *
 * Every file here `describe.skipIf`s itself when `DATABASE_URL` is unset, so
 * running this config without a database is a no-op rather than a wall of red.
 */
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.pg.test.ts', 'packages/*/src/**/*.pg.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // A scan job with a checkpointer does real work against a real database.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One database, shared: parallel files truncating the same tables would
    // delete each other's rows.
    fileParallelism: false,
  },
});
