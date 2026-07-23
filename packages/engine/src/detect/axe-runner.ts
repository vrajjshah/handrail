import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from 'playwright';

import { IsolatedWorld } from '../capture/isolated-world.js';
import type { StateCapture } from '../capture/types.js';
import { mapAxeResult } from './axe-detect.js';
import type { AxeResultGroup } from './axe-types.js';
import type {
  AxeDetectionResult,
  EnrichedAxeGroup,
  EnrichedAxeNode,
  EnrichedAxeResult,
} from './types.js';

/** The axe-core UMD bundle, read once and reused across runs. */
const AXE_SOURCE = (() => {
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
})();

/**
 * The shape the main-world runner returns before xpath resolution.
 *
 * Trimmed in the page: axe's full result carries hundreds of inapplicable rules
 * and every passing node's relatedNodes, none of which we need, and shipping them
 * across the CDP boundary is the slow part.
 */
interface RawRun {
  axeVersion: string;
  violations: AxeResultGroup[];
  incomplete: AxeResultGroup[];
  passes: { id: string; nodeCount: number }[];
}

/**
 * Runs axe over the current page state and maps the result to findings.
 *
 * **Order matters: call this after `captureState`, never before.** axe runs in
 * the page's own realm — injecting the bundle defines `window.axe` and running it
 * touches the DOM — which is exactly the mutation the capture goes to lengths to
 * avoid. Capturing first means the element index reflects the untouched page, and
 * axe then runs against the same load so its findings line up with that index.
 */
export async function runAxeDetection(
  page: Page,
  capture: StateCapture,
): Promise<AxeDetectionResult> {
  await page.evaluate(AXE_SOURCE);

  // axe runs in the page's own realm, where the bundler's `__name` helper does
  // not exist — so this evaluate must not *declare* anything (a named function or
  // even a `const f = () =>` triggers it). Only the arguments axe needs and one
  // inline anonymous mapper. Full groups cross the boundary and are trimmed in
  // Node; only `resultTypes` and dropping `inapplicable` keep the payload sane.
  const raw = (await page.evaluate(() =>
    (
      globalThis as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: unknown,
          ) => Promise<{
            testEngine: { version: string };
            violations: unknown[];
            incomplete: unknown[];
            passes: { id: string; nodes: unknown[] }[];
          }>;
        };
      }
    ).axe
      .run(document, { resultTypes: ['violations', 'incomplete', 'passes'] })
      .then((full) => ({
        axeVersion: full.testEngine.version,
        violations: full.violations,
        incomplete: full.incomplete,
        passes: full.passes.map((group) => ({ id: group.id, nodeCount: group.nodes.length })),
      })),
  )) as RawRun;

  const enriched = await enrichWithXpaths(page, raw);
  return mapAxeResult(enriched, capture);
}

/**
 * Resolves every violation and incomplete node's target selector to an xpath in
 * one isolated-world call, then stitches the xpaths back onto the groups.
 */
async function enrichWithXpaths(page: Page, raw: RawRun): Promise<EnrichedAxeResult> {
  const groups = [...raw.violations, ...raw.incomplete];
  const targets = groups.flatMap((group) => group.nodes.map((node) => node.target.join(' ')));

  const world = await IsolatedWorld.create(page, 'handrail-axe');
  let xpaths: (string | null)[];
  try {
    const { resolveTargetXpaths } = await import('./resolve-xpaths.browser.js');
    xpaths = await world.evaluate(resolveTargetXpaths, targets);
  } finally {
    await world.dispose();
  }

  let cursor = 0;
  const enrich = (group: AxeResultGroup): EnrichedAxeGroup => ({
    ...group,
    nodes: group.nodes.map((node): EnrichedAxeNode => ({ ...node, xpath: xpaths[cursor++] ?? null })),
  });

  return {
    axeVersion: raw.axeVersion,
    violations: raw.violations.map(enrich),
    incomplete: raw.incomplete.map(enrich),
    passes: raw.passes,
  };
}
