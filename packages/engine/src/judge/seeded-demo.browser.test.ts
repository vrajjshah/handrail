import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IsolatedWorld } from '../capture/isolated-world.js';
import { ConsoleRecorder, captureState } from '../capture/state-capture.js';
import { StateCaptureSchema, type StateCapture } from '../capture/types.js';
import { serveSeededDemo, type FixtureServer } from '../scripts/serve-fixture.js';
import {
  DESKTOP,
  normalizeCapture,
  readGroundTruthAnchors,
  type GroundTruthAnchors,
} from '../scripts/seeded-demo-fixture.js';
import { buildElementExtract, renderExtract } from './element-extract.js';

/**
 * The anti-rot guard for the committed capture.
 *
 * `seeded-demo.test.ts` runs the whole verdict pipeline against a frozen capture
 * so it can stay in the default (browser-free, three-OS) suite. Freezing an input
 * is only honest if something notices when the input stops being true, and this
 * is that something: it re-captures the live fixture and fails if the projection
 * the judge actually reads has changed.
 *
 * The comparison is on the *extract*, not the raw capture, on purpose. Bounding
 * boxes and computed styles shift with a Chromium bump and mean nothing to a
 * text judge; the element ids, roles, names and attributes are the contract.
 */

let server: FixtureServer;
let browser: Browser;

const here = fileURLToPath(new URL('.', import.meta.url));

function committed<T>(file: string): T {
  return JSON.parse(readFileSync(`${here}__fixtures__/${file}`, 'utf8')) as T;
}

beforeAll(async () => {
  server = await serveSeededDemo();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('the committed seeded-demo capture', () => {
  it('still matches what the fixture app actually serves', async () => {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    try {
      const page = await context.newPage();
      const recorder = new ConsoleRecorder(page);
      await page.goto(server.origin, { waitUntil: 'networkidle' });

      const live = normalizeCapture(
        await captureState(page, { viewport: DESKTOP }, recorder),
        server.origin,
      );
      const world = await IsolatedWorld.create(page, 'handrail-fixture-anchors');
      const anchors = await readGroundTruthAnchors(world);

      const frozen: StateCapture = StateCaptureSchema.parse(
        committed('seeded-demo-desktop.capture.json'),
      );

      expect(renderExtract(buildElementExtract(live))).toBe(
        renderExtract(buildElementExtract(frozen)),
      );
      expect(anchors).toEqual(committed<GroundTruthAnchors>('seeded-demo-anchors.json'));
    } finally {
      await context.close();
    }
  });
});
