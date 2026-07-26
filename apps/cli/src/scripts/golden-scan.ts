/**
 * The golden scan.
 *
 *   pnpm --filter @handrail/cli golden:scan            # check (what CI runs)
 *   pnpm --filter @handrail/cli golden:scan --update   # re-record after an intended change
 *
 * A full deterministic scan of the seeded-demo, normalised and diffed against a
 * committed snapshot. This catches orchestration and report-shape drift that no
 * unit test sees: a node running out of order, an event vanishing from the
 * stream, a rollup status flipping. Screenshots are off — PNG bytes are the one
 * genuinely unstable output, and the snapshot is about shape, not pixels.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runScan } from '@handrail/orchestrator';
import { createPlaywrightDriver } from '@handrail/orchestrator';
import { ScanOptionsSchema, ScanTargetSchema, scanId } from '@handrail/schemas';
import { chromium } from 'playwright';

import { buildSnapshot, describeDiff, serializeSnapshot } from '../golden.js';
import { REPO_ROOT, serveFixture } from './fixture-server.js';

const GOLDEN_FILE = join(REPO_ROOT, 'fixtures', 'golden', 'seeded-demo.snapshot.json');

/**
 * A fixed port — see `serveFixture`. The scanned URL is hashed into every
 * finding id, so an ephemeral one would churn the whole snapshot each run.
 */
const GOLDEN_PORT = 5179;

async function main(): Promise<void> {
  const update = process.argv.includes('--update');

  const fixture = await serveFixture(GOLDEN_PORT);
  const browser = await chromium.launch();
  let actual: string;

  try {
    const driver = createPlaywrightDriver(browser);
    const result = await runScan(
      {
        // Fixed id: the snapshot must not change because a uuid did. The
        // normaliser scrubs it anyway; this makes a raw run readable too.
        scanId: scanId('scan_golden'),
        target: ScanTargetSchema.parse({
          kind: 'url',
          url: fixture.origin,
          viewports: [{ label: 'desktop', width: 1280, height: 800 }],
        }),
        options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
      },
      { driver },
    );
    actual = serializeSnapshot(buildSnapshot(result.events, result.report));
  } finally {
    await browser.close();
    await fixture.close();
  }

  if (update) {
    await writeFile(GOLDEN_FILE, actual, 'utf8');
    console.log(`updated ${GOLDEN_FILE}`);
    return;
  }

  let expected: string;
  try {
    expected = await readFile(GOLDEN_FILE, 'utf8');
  } catch {
    console.error(
      `no golden committed at ${GOLDEN_FILE}.\n` +
        'Run: pnpm --filter @handrail/cli golden:scan --update',
    );
    process.exitCode = 1;
    return;
  }

  if (expected === actual) {
    console.log('golden scan matches the committed snapshot');
    return;
  }

  console.error('The golden scan no longer matches the committed snapshot.\n');
  console.error(describeDiff(expected, actual));
  console.error(
    '\nIf this change was intended, re-record it in the same PR:\n' +
      '  pnpm --filter @handrail/fixture-seeded-demo build\n' +
      '  pnpm --filter @handrail/cli golden:scan --update\n' +
      'and commit the updated snapshot so the diff is reviewed alongside the change.',
  );
  process.exitCode = 1;
}

await main();
