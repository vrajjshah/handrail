/**
 * Regenerates the committed seeded-demo capture the text-judge suites run against.
 *
 *     pnpm --filter @handrail/fixture-seeded-demo build
 *     pnpm --filter @handrail/engine capture:seeded-demo
 *
 * Why commit a capture at all: the verdict pipeline's acceptance test has to run
 * in the default `pnpm test`, on macOS and Windows, with no browser download and
 * no network. Hand-writing an element index instead would be the worst of both
 * worlds — a test that passes against a page that does not exist. So the input is
 * real, taken from the real fixture app, and frozen.
 *
 * `seeded-demo.browser.test.ts` re-captures the live app and fails if this file
 * has drifted, which is what stops the freeze from rotting. **This module runs on
 * import** — the reusable pieces live in `seeded-demo-fixture.ts` so that guard
 * can import them without regenerating the file it is checking.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { IsolatedWorld } from '../capture/isolated-world.js';
import { ConsoleRecorder, captureState } from '../capture/state-capture.js';
import { DESKTOP, normalizeCapture, readGroundTruthAnchors } from './seeded-demo-fixture.js';
import { serveSeededDemo } from './serve-fixture.js';

async function main(): Promise<void> {
  const server = await serveSeededDemo();
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    const page = await context.newPage();
    const recorder = new ConsoleRecorder(page);
    await page.goto(server.origin, { waitUntil: 'networkidle' });

    const captured = await captureState(page, { viewport: DESKTOP }, recorder);
    const world = await IsolatedWorld.create(page, 'handrail-fixture-anchors');
    const anchors = await readGroundTruthAnchors(world);

    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', 'judge', '__fixtures__');

    writeFileSync(
      join(outDir, 'seeded-demo-desktop.capture.json'),
      `${JSON.stringify(normalizeCapture(captured, server.origin), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(outDir, 'seeded-demo-anchors.json'),
      `${JSON.stringify(anchors, null, 2)}\n`,
      'utf8',
    );

    console.log(
      `captured ${String(captured.elements.length)} elements and ${String(Object.keys(anchors).length)} ground-truth anchors`,
    );
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
