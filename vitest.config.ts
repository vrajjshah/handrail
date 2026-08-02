import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // Browser suites need a real Chromium and run in their own ubuntu-only CI
    // job; keeping them out here is what lets `unit` stay green on all three OSes.
    // `*.r2.test.ts` needs cloud credentials and therefore has no CI job at all.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.browser.test.ts',
      '**/*.pg.test.ts',
      '**/*.r2.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
