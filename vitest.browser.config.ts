import { defineConfig } from 'vitest/config';

/**
 * The suites that drive a real Chromium.
 *
 * Split from the default config because they need a browser download and only
 * run on ubuntu in CI, while the unit suite has to stay green on macOS and
 * Windows too. Generous timeouts: launching a browser and capturing a page is
 * seconds, not milliseconds.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.browser.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser at a time keeps the CI runner honest about memory.
    fileParallelism: false,
  },
});
