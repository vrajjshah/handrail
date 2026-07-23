import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { serveSeededDemo, type FixtureServer } from '../scripts/serve-fixture.js';
import { MemoryArtifactStore, cropToElement } from './artifacts.js';
import { deriveApplicabilitySignals } from './signals.js';
import { ConsoleRecorder, captureState, computePageStateId } from './state-capture.js';
import { StateCaptureSchema, type StateCapture } from './types.js';

const DESKTOP = { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 } as const;

let server: FixtureServer;
let browser: Browser;

/** Loads the fixture and captures it, sharing one browser across the suite. */
async function capture(
  options: { artifacts?: MemoryArtifactStore } = {},
): Promise<{ capture: StateCapture; page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
  });
  const page = await context.newPage();
  const recorder = new ConsoleRecorder(page);
  await page.goto(server.origin, { waitUntil: 'networkidle' });

  const result = await captureState(
    page,
    { viewport: DESKTOP, ...(options.artifacts ? { artifacts: options.artifacts } : {}) },
    recorder,
  );
  return { capture: result, page, close: () => context.close() };
}

beforeAll(async () => {
  server = await serveSeededDemo();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('capturing the seeded demo', () => {
  it('produces a schema-valid, serialisable state', async () => {
    const { capture: state, close } = await capture();
    try {
      expect(() => StateCaptureSchema.parse(state)).not.toThrow();
      // It has to survive the round trip to disk that report.json and the
      // golden-scan snapshot both depend on.
      expect(StateCaptureSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    } finally {
      await close();
    }
  });

  it('indexes every ground-truth anchor in the fixture', async () => {
    const { capture: state, page, close } = await capture();
    try {
      // Compute each anchor's xpath in the page, then require the index to
      // contain it. This is the acceptance criterion for the element index:
      // if a check cannot find the element, it cannot report on it.
      const anchorXpaths = await page.evaluate(() =>
        [...document.querySelectorAll('[data-gt],[data-trap]')].map((el) => {
          const parts: string[] = [];
          for (let n: Element | null = el; n !== null; n = n.parentElement) {
            let i = 1;
            for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
              if (s.tagName === n.tagName) i += 1;
            }
            parts.unshift(`${n.tagName.toLowerCase()}[${String(i)}]`);
          }
          return `/${parts.join('/')}`;
        }),
      );

      // 12 of the 14 seeded defects carry an anchor on the initial state:
      // gt-011 is the <html> element's *missing* lang attribute, so it has no
      // anchor to carry, and gt-014 only exists once the dialog is opened.
      // Plus the 6 traps.
      expect(anchorXpaths).toHaveLength(18);

      const indexed = new Set(state.elements.map((el) => el.xpath));
      for (const xpath of anchorXpaths) {
        expect(indexed.has(xpath), xpath).toBe(true);
      }

      // gt-011's subject is the document element, which must be indexed too —
      // a check for a missing lang attribute has nothing to attach to otherwise.
      expect(indexed.has('/html[1]')).toBe(true);
    } finally {
      await close();
    }
  });

  it('gives every element a selector that resolves back to it', async () => {
    const { capture: state, page, close } = await capture();
    try {
      // Selector quality is not cosmetic: it is what a developer pastes into
      // devtools and what the Phase 4 source matcher works from.
      const sample = state.elements.filter((el) => el.visible).slice(0, 120);
      const resolved = await page.evaluate(
        (pairs) =>
          pairs.map(({ selector, xpath }) => {
            let found: NodeListOf<Element>;
            try {
              found = document.querySelectorAll(selector);
            } catch {
              return { selector, ok: false };
            }
            if (found.length !== 1) return { selector, ok: false };
            const parts: string[] = [];
            for (let n: Element | null = found[0] ?? null; n !== null; n = n.parentElement) {
              let i = 1;
              for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
                if (s.tagName === n.tagName) i += 1;
              }
              parts.unshift(`${n.tagName.toLowerCase()}[${String(i)}]`);
            }
            return { selector, ok: `/${parts.join('/')}` === xpath };
          }),
        sample.map((el) => ({ selector: el.selector, xpath: el.xpath })),
      );

      for (const entry of resolved) {
        expect(entry.ok, entry.selector).toBe(true);
      }
    } finally {
      await close();
    }
  });

  it('reads roles and accessible names from Chromium, not a reimplementation', async () => {
    const { capture: state, close } = await capture();
    try {
      expect(state.axTreeSource).toBe('cdp');

      const byXpathAttr = (attr: string, value: string) =>
        state.elements.find((el) => el.attributes[attr] === value);

      // The flagship fixture case: the accessible name is the (wrong) alt text.
      const lyingAlt = state.elements.find(
        (el) => el.tag === 'img' && el.attributes.alt?.startsWith('Fans celebrating'),
      );
      expect(lyingAlt?.role).toBe('image');
      expect(lyingAlt?.accessibleName).toBe(
        'Fans celebrating a football victory in a packed stadium',
      );

      // A label/for association has to surface as the control's name — this is
      // the computation we would have got wrong by hand.
      const select = byXpathAttr('id', 'party-size');
      expect(select?.role).toBe('combobox');
      expect(select?.accessibleName).toBe('Number of guests');

      // aria-label on an icon button.
      const iconButton = state.elements.find(
        (el) => el.attributes['aria-label'] === 'One more bottle of Domaine Perrot',
      );
      expect(iconButton?.accessibleName).toBe('One more bottle of Domaine Perrot');
    } finally {
      await close();
    }
  });

  it('records the fixture\'s missing lang, which is a seeded defect', async () => {
    const { capture: state, close } = await capture();
    try {
      expect(state.documentLang).toBeNull();
      expect(state.title).toBe('Northwind Supper Club');
    } finally {
      await close();
    }
  });

  it('measures focusability and tab order from the live document', async () => {
    const { capture: state, close } = await capture();
    try {
      const positiveTabIndex = state.elements.filter((el) => el.tabIndex > 0);
      // gt-008 plants a single positive tabindex on the Contact link.
      expect(positiveTabIndex.map((el) => el.tabIndex)).toEqual([1]);

      const smallButton = state.elements.find(
        (el) => el.attributes['aria-label'] === 'One more bottle of Domaine Perrot',
      );
      expect(smallButton?.focusable).toBe(true);

      // A plain container is not focusable, and the check must not confuse
      // "has a bounding box" with "can receive focus".
      const paragraph = state.elements.find((el) => el.tag === 'p');
      expect(paragraph?.focusable).toBe(false);
    } finally {
      await close();
    }
  });

  it('captures the computed styles the checks actually read', async () => {
    const { capture: state, close } = await capture();
    try {
      const lowContrast = state.elements.find((el) => el.style.color === 'rgb(148, 148, 148)');
      expect(lowContrast, 'the seeded #949494 text should be indexed').toBeDefined();
      expect(lowContrast?.style.fontSize).toBe('16px');

      // The seeded reflow defect: a fixed 720px table inside a narrower page.
      const wideTable = state.elements.find((el) => el.tag === 'table');
      expect(wideTable?.bbox?.width).toBe(720);
    } finally {
      await close();
    }
  });
});

describe('hostile page content', () => {
  it('escapes attribute values that would otherwise break out of the selector', async () => {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    const page = await context.newPage();
    try {
      // A scanner points at arbitrary URLs, so page content is untrusted input.
      // Each of these ends in or contains characters that break naive escaping;
      // a trailing backslash escapes the closing quote and changes what the
      // generated selector matches.
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        const hostile = [
          String.raw`trailing-backslash\\`,
          'has"quote',
          String.raw`both\\"mixed`,
          'x" i], [data-testid="injected',
        ];
        for (const value of hostile) {
          const el = document.createElement('div');
          el.setAttribute('data-testid', value);
          el.textContent = 'hostile';
          document.body.append(el);
        }
      });

      const state = await captureState(page, { viewport: DESKTOP });
      const hostileElements = state.elements.filter((el) => el.text === 'hostile');
      expect(hostileElements).toHaveLength(4);

      // The escaping has to actually work, not merely be survivable.
      // `selectorOf` verifies every candidate with `resolvesUniquely` and falls
      // back to a structural path when it fails — which means a *correct*
      // selector is not evidence of correct escaping. What distinguishes them is
      // whether the data-testid form was usable at all: with incomplete
      // escaping these values produce an invalid selector, it is rejected, and
      // the element silently drops to nth-of-type.
      for (const el of hostileElements) {
        expect(el.selector.startsWith('[data-testid='), el.selector).toBe(true);
      }

      // And it must still resolve to exactly its own element.
      const results = await page.evaluate(
        (pairs) =>
          pairs.map(({ selector, xpath }) => {
            let found: NodeListOf<Element>;
            try {
              found = document.querySelectorAll(selector);
            } catch {
              return { selector, ok: false, reason: 'threw' };
            }
            if (found.length !== 1) return { selector, ok: false, reason: `matched ${String(found.length)}` };
            const parts: string[] = [];
            for (let n: Element | null = found[0] ?? null; n !== null; n = n.parentElement) {
              let i = 1;
              for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
                if (s.tagName === n.tagName) i += 1;
              }
              parts.unshift(`${n.tagName.toLowerCase()}[${String(i)}]`);
            }
            return { selector, ok: `/${parts.join('/')}` === xpath, reason: 'wrong element' };
          }),
        hostileElements.map((el) => ({ selector: el.selector, xpath: el.xpath })),
      );

      for (const result of results) {
        expect(result.ok, `${result.selector} — ${result.reason}`).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
});

describe('interaction-dependent states', () => {
  it('captures the keyboard trap that only exists once the dialog is open', async () => {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    const page = await context.newPage();
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });

      const closed = await captureState(page, { viewport: DESKTOP });
      expect(closed.elements.some((el) => el.attributes.role === 'dialog')).toBe(false);

      await page.click('[data-gt="gt-005"]');
      const opened = await captureState(page, {
        viewport: DESKTOP,
        interactionPath: ['click [data-gt="gt-005"]'],
      });

      // The state the crawler reaches by interaction rather than by URL — which
      // is where gt-014 lives, and the reason a URL-only scanner never sees it.
      const dialog = opened.elements.find((el) => el.attributes.role === 'dialog');
      expect(dialog).toBeDefined();
      expect(dialog?.accessibleName).toBe('Join the supper notes list');

      // Same URL, different state: the ids must differ or the two captures
      // would collide in the report and the judgment cache.
      expect(opened.pageStateId).not.toBe(closed.pageStateId);
      expect(opened.interactionPath).toEqual(['click [data-gt="gt-005"]']);
    } finally {
      await context.close();
    }
  });
});

describe('the target page is left untouched', () => {
  it('adds no globals and no attributes', async () => {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    const page = await context.newPage();
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });

      const before = await page.content();
      await captureState(page, { viewport: DESKTOP });
      const after = await page.content();

      // The strongest available statement: the serialised DOM is byte-identical.
      expect(after).toBe(before);

      // And the isolated world's shim never reached the page's own realm.
      expect(await page.evaluate('typeof globalThis.__name')).toBe('undefined');
      expect(await page.evaluate('typeof globalThis.__handrail')).toBe('undefined');
    } finally {
      await context.close();
    }
  });
});

describe('determinism', () => {
  it('re-captures an unchanged page to an identical index', async () => {
    const first = await capture();
    const second = await capture();
    try {
      expect(second.capture.pageStateId).toBe(first.capture.pageStateId);
      expect(second.capture.elements).toEqual(first.capture.elements);
      expect(second.capture.media).toEqual(first.capture.media);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('derives the page state id from url, viewport and interaction path', () => {
    const base = computePageStateId('https://example.com/', 'desktop', []);

    expect(computePageStateId('https://example.com/', 'desktop', [])).toBe(base);
    expect(computePageStateId('https://example.com/', 'mobile', [])).not.toBe(base);
    expect(computePageStateId('https://example.com/x', 'desktop', [])).not.toBe(base);
    expect(computePageStateId('https://example.com/', 'desktop', ['click #open'])).not.toBe(base);
  });
});

describe('screenshots and crops', () => {
  it('stores full-page and viewport artifacts', async () => {
    const store = new MemoryArtifactStore();
    const { capture: state, close } = await capture({ artifacts: store });
    try {
      expect(state.artifacts.fullPage).not.toBeNull();
      expect(state.artifacts.viewport).not.toBeNull();
      expect(store.size).toBe(2);
      expect(state.degradations).toEqual([]);
    } finally {
      await close();
    }
  });

  it('crops an element out of the full-page screenshot using its bbox', async () => {
    const store = new MemoryArtifactStore();
    const { capture: state, close } = await capture({ artifacts: store });
    try {
      const image = state.elements.find(
        (el) => el.tag === 'img' && el.attributes.alt?.startsWith('Fans celebrating'),
      );
      expect(image?.bbox).toBeDefined();

      const fullPage = await store.get(state.artifacts.fullPage!);
      const crop = await cropToElement(fullPage, image!.bbox!);

      // A crop that lands on the right region is the evidence a vision finding
      // stands on; getting document-vs-viewport coordinates wrong yields a
      // plausible-looking image of the wrong part of the page.
      expect(crop.byteLength).toBeGreaterThan(0);
      expect(crop.byteLength).toBeLessThan(fullPage.byteLength);
      const sharpModule = await import('sharp');
      const meta = await sharpModule.default(crop).metadata();
      expect(meta.width).toBeLessThanOrEqual(300);
      expect(meta.height).toBeLessThanOrEqual(300);
    } finally {
      await close();
    }
  });
});

describe('applicability signals', () => {
  it('reports what the page actually contains', async () => {
    const { capture: state, close } = await capture();
    try {
      const signals = deriveApplicabilitySignals([state], 1);

      expect(signals.hasImages).toBe(true);
      expect(signals.hasForms).toBe(true);
      expect(signals.hasLinks).toBe(true);
      expect(signals.hasHeadings).toBe(true);
      expect(signals.hasTables).toBe(true);
      expect(signals.pagesInScan).toBe(1);

      // No video on the fixture — and the signal says "we saw none", which the
      // reference turns into `unknown` rather than excusing the criterion.
      expect(signals.hasPrerecordedVideo).toBe(false);
      expect(signals.hasAuthentication).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('the fixture build is the one under test', () => {
  it('matches the committed ground truth anchor count', async () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const groundTruthPath = join(
      here, '..', '..', '..', '..', 'fixtures', 'apps', 'seeded-demo', 'ground-truth.json',
    );
    const groundTruth = JSON.parse(await readFile(groundTruthPath, 'utf8')) as {
      expected: { id: string }[];
      traps: { id: string }[];
    };

    expect(groundTruth.expected).toHaveLength(14);
    expect(groundTruth.traps).toHaveLength(6);
  });
});
