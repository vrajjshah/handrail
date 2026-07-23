import axe from 'axe-core';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { captureState } from '../capture/state-capture.js';
import type { StateCapture } from '../capture/types.js';
import { serveSeededDemo, type FixtureServer } from '../capture/__test__/serve-fixture.js';
import { runAxeDetection } from './axe-runner.js';
import type { AxeDetectionResult } from './types.js';

const DESKTOP = { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 } as const;

let server: FixtureServer;
let browser: Browser;

/**
 * Loads the fixture, captures it, then runs axe against the same load.
 *
 * The capture must come first — axe injects itself into the page's realm, which
 * is exactly the mutation the capture avoids, so the element index has to be
 * taken from the untouched page before axe touches it.
 */
async function detect(): Promise<{
  detection: AxeDetectionResult;
  capture: StateCapture;
  page: Page;
  close: () => Promise<void>;
}> {
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
  });
  const page = await context.newPage();
  await page.goto(server.origin, { waitUntil: 'networkidle' });

  const capture = await captureState(page, { viewport: DESKTOP });
  const detection = await runAxeDetection(page, capture);
  return { detection, capture, page, close: () => context.close() };
}

beforeAll(async () => {
  server = await serveSeededDemo();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('the acceptance criterion: axe-catchable seeded issues', () => {
  it('finds gt-002, gt-004 and gt-011 at violation tier with tool evidence', async () => {
    const { detection, close } = await detect();
    try {
      const byRule = (ruleId: string) =>
        detection.findings.filter((f) => f.checkId === `axe.${ruleId}`);

      // Each of the three is a violation, carries axe-core tool evidence, and is
      // attributed to the criterion axe itself tags the rule with.
      const cases = [
        { rule: 'image-alt', sc: '1.1.1', gt: 'gt-002' },
        { rule: 'color-contrast', sc: '1.4.3', gt: 'gt-004' },
        { rule: 'html-has-lang', sc: '3.1.1', gt: 'gt-011' },
      ] as const;

      for (const { rule, sc } of cases) {
        const findings = byRule(rule);
        expect(findings.length, rule).toBeGreaterThanOrEqual(1);
        const finding = findings[0]!;
        expect(finding.tier, rule).toBe('violation');
        expect(finding.scPrimary, rule).toBe(sc);
        expect(finding.source, rule).toEqual(['axe']);

        const toolEvidence = finding.evidence.find((e) => e.kind === 'tool');
        expect(toolEvidence, `${rule} tool evidence`).toMatchObject({ tool: 'axe-core', ruleId: rule });
        expect((toolEvidence as { output: string }).output.length).toBeGreaterThan(0);
      }
    } finally {
      await close();
    }
  });

  it('grounds the contrast finding to the seeded #949494 element with pixel evidence', async () => {
    const { detection, close } = await detect();
    try {
      const contrast = detection.findings.find((f) => f.checkId === 'axe.color-contrast');
      expect(contrast).toBeDefined();

      // axe measured the ratio; that becomes deterministic pixel evidence, not a
      // model's opinion. This is what lets the finding sit at `violation`.
      const pixels = contrast!.evidence.find((e) => e.kind === 'pixels');
      expect(pixels).toMatchObject({ metric: 'contrast-ratio', comparator: 'gte' });
      expect((pixels as { measured: number }).measured).toBeCloseTo(3.03, 1);
      expect((pixels as { threshold: number }).threshold).toBe(4.5);

      // And it is grounded — a real element with a box the report can crop to.
      expect(contrast!.element?.bbox).toBeDefined();
    } finally {
      await close();
    }
  });

  it('lands the html-has-lang finding on the document element', async () => {
    const { detection, close } = await detect();
    try {
      const lang = detection.findings.find((f) => f.checkId === 'axe.html-has-lang');
      expect(lang?.element?.selector).toBe('html');
      expect(lang?.tier).toBe('violation');
    } finally {
      await close();
    }
  });
});

describe('the axe blind spot the fixture exists to show', () => {
  it('does NOT catch the placeholder-only label (gt-003)', async () => {
    const { detection, page, close } = await detect();
    try {
      // gt-003 is a real 3.3.2 failure — a placeholder is not a persistent label
      // — but Chromium computes the field's accessible name *from* the
      // placeholder, so axe's label rule passes it. Every rule engine reports it
      // clean. This is the gap the AI layers exist to close, and locking it in as
      // a test means a future axe change that starts catching it (or a
      // regression that makes us over-report) is caught here.
      const gt003Xpath = await page.evaluate(() => {
        const el = document.querySelector('[data-gt="gt-003"]');
        if (el === null) return null;
        const parts: string[] = [];
        for (let n: Element | null = el; n !== null; n = n.parentElement) {
          let i = 1;
          for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
            if (s.tagName === n.tagName) i += 1;
          }
          parts.unshift(`${n.tagName.toLowerCase()}[${String(i)}]`);
        }
        return `/${parts.join('/')}`;
      });

      const onGt003 = detection.findings.filter((f) => f.element?.xpath === gt003Xpath);
      expect(onGt003).toEqual([]);

      // Concretely: axe's label rule *passed* on this page — the accessible name
      // exists, it is just the wrong kind of name.
      expect(detection.passes.some((p) => p.ruleId === 'label')).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('faithful reporting', () => {
  it('records passes as evidence, never as findings', async () => {
    const { detection, close } = await detect();
    try {
      expect(detection.passes.length).toBeGreaterThan(0);
      for (const pass of detection.passes) {
        expect(pass.sc.length, pass.ruleId).toBeGreaterThan(0);
        expect(pass.nodeCount, pass.ruleId).toBeGreaterThan(0);
      }
      // Every finding is a violation or needs-review — a pass never becomes one.
      for (const finding of detection.findings) {
        expect(['violation', 'needs-review']).toContain(finding.tier);
      }
    } finally {
      await close();
    }
  });

  it('runs the axe our committed rule map was built from, so no version mismatch', async () => {
    const { detection, close } = await detect();
    try {
      expect(detection.axeVersion).toBe(axe.version);
      expect(detection.degradations.map((d) => d.reason)).not.toContain('axe-version-mismatch');
    } finally {
      await close();
    }
  });

  it('emits deterministic finding ids — a re-run of the same page matches', async () => {
    const first = await detect();
    const second = await detect();
    try {
      const ids = (r: AxeDetectionResult) => r.findings.map((f) => f.id).sort();
      expect(ids(second.detection)).toEqual(ids(first.detection));
    } finally {
      await first.close();
      await second.close();
    }
  });
});
