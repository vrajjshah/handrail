import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { captureState } from '../../capture/state-capture.js';
import { serveSeededDemo, type FixtureServer } from '../../scripts/serve-fixture.js';
import { allFindings } from './types.js';
import { runHeuristics } from './run-heuristics.js';
import type { HeuristicResult } from './types.js';

const DESKTOP = { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 } as const;
const REFLOW = { label: 'reflow-320', width: 320, height: 800, deviceScaleFactor: 1 } as const;

let server: FixtureServer;
let browser: Browser;

async function analyze(
  viewport: typeof DESKTOP | typeof REFLOW,
): Promise<{ result: HeuristicResult; gtXpath: (id: string) => Promise<string>; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await page.goto(server.origin, { waitUntil: 'networkidle' });

  const capture = await captureState(page, { viewport });
  const result = await runHeuristics(page, capture);

  const gtXpath = (id: string): Promise<string> =>
    page.evaluate((anchor) => {
      const el = document.querySelector(`[data-gt="${anchor}"],[data-trap="${anchor}"]`);
      if (el === null) throw new Error(`no element for ${anchor}`);
      const parts: string[] = [];
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        let i = 1;
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
          if (s.tagName === n.tagName) i += 1;
        }
        parts.unshift(`${n.tagName.toLowerCase()}[${String(i)}]`);
      }
      return `/${parts.join('/')}`;
    }, id);

  return { result, gtXpath, close: () => context.close() };
}

beforeAll(async () => {
  server = await serveSeededDemo();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('the acceptance criterion: heuristic-catchable seeded issues', () => {
  it('catches gt-005, gt-008 and gt-009 on the desktop capture', async () => {
    const { result, gtXpath, close } = await analyze(DESKTOP);
    try {
      const findings = allFindings(result);
      const onXpath = (xpath: string) => findings.filter((f) => f.element?.xpath === xpath);

      // gt-008 — kbd.walk, focus order (2.4.3)
      const gt008 = await gtXpath('gt-008');
      expect(onXpath(gt008).some((f) => f.checkId === 'kbd.walk' && f.tier === 'violation')).toBe(true);

      // gt-005 — kbd.focus-visible (2.4.7)
      const gt005 = await gtXpath('gt-005');
      const fv = onXpath(gt005).find((f) => f.checkId === 'kbd.focus-visible');
      expect(fv?.tier).toBe('violation');
      expect(fv?.evidence.some((e) => e.kind === 'pixels' && e.metric === 'focus-indicator-delta')).toBe(true);

      // gt-009 — ptr.target-size (2.5.8)
      const gt009 = await gtXpath('gt-009');
      const ts = onXpath(gt009).find((f) => f.checkId === 'ptr.target-size');
      expect(ts?.tier).toBe('violation');
      expect(ts?.evidence.some((e) => e.kind === 'pixels' && e.metric === 'target-size-px')).toBe(true);
    } finally {
      await close();
    }
  });

  it('catches gt-007 on the 320px capture', async () => {
    const { result, gtXpath, close } = await analyze(REFLOW);
    try {
      const gt007 = await gtXpath('gt-007');
      const finding = allFindings(result).find(
        (f) => f.checkId === 'resp.reflow-320' && f.element?.xpath === gt007,
      );
      expect(finding?.tier).toBe('violation');
      expect(finding?.scPrimary).toBe('1.4.10');
    } finally {
      await close();
    }
  });

  it('every heuristic finding is a deterministic violation with grounded evidence', async () => {
    const { result, close } = await analyze(DESKTOP);
    try {
      for (const finding of allFindings(result)) {
        expect(finding.source[0]).toMatch(/^heuristic:/);
        expect(finding.tier).toBe('violation');
        // Grounded: a real element with a box the report can crop to.
        expect(finding.element?.elementId).toBeDefined();
        // Carries deterministic evidence, which is what earns `violation` tier.
        expect(finding.evidence.some((e) => e.kind === 'pixels' || e.kind === 'tool')).toBe(true);
      }
    } finally {
      await close();
    }
  });
});

describe('the traps — where the exception ladders earn their keep', () => {
  it('does not flag the isolated undersized button (spacing exception) or the 24px one', async () => {
    const { result, gtXpath, close } = await analyze(DESKTOP);
    try {
      const targetSize = allFindings(result).filter((f) => f.checkId === 'ptr.target-size');

      const spacing = await gtXpath('trap-target-size-spacing');
      const ok = await gtXpath('trap-target-size-ok');
      expect(targetSize.some((f) => f.element?.xpath === spacing)).toBe(false);
      expect(targetSize.some((f) => f.element?.xpath === ok)).toBe(false);
    } finally {
      await close();
    }
  });

  it('does not flag the control that keeps its focus ring via :focus-visible', async () => {
    const { result, gtXpath, close } = await analyze(DESKTOP);
    try {
      const focusVisible = allFindings(result).filter((f) => f.checkId === 'kbd.focus-visible');
      const trap = await gtXpath('trap-focus-ring-ok');
      expect(focusVisible.some((f) => f.element?.xpath === trap)).toBe(false);
    } finally {
      await close();
    }
  });

  it('produces exactly one finding per check — a clean baseline', async () => {
    // The fixture is tuned so each seeded defect maps to one finding. If a
    // heuristic starts over- or under-reporting, this is where it shows up.
    const { result, close } = await analyze(REFLOW);
    try {
      const count = (checkId: string) =>
        allFindings(result).filter((f) => f.checkId === checkId).length;
      expect(count('kbd.walk')).toBe(1);
      expect(count('kbd.focus-visible')).toBe(1);
      expect(count('ptr.target-size')).toBe(1);
      expect(count('resp.reflow-320')).toBe(1);
    } finally {
      await close();
    }
  });
});

describe('determinism', () => {
  it('re-runs to identical finding ids', async () => {
    const first = await analyze(DESKTOP);
    const second = await analyze(DESKTOP);
    try {
      const ids = (r: HeuristicResult) => allFindings(r).map((f) => f.id).sort();
      expect(ids(second.result)).toEqual(ids(first.result));
    } finally {
      await first.close();
      await second.close();
    }
  });
});
