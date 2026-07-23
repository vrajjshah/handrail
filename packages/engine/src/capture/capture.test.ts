import { elementId, pageStateId } from '@handrail/schemas';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { MemoryArtifactStore, cropToElement, normaliseForVision } from './artifacts.js';
import { deriveApplicabilitySignals } from './signals.js';
import { computePageStateId } from './state-capture.js';
import type { ElementRecord, StateCapture } from './types.js';

const BLANK_STYLE: ElementRecord['style'] = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  fontSize: '16px',
  fontWeight: '400',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  overflowX: 'visible',
  overflowY: 'visible',
  whiteSpace: 'normal',
  cursor: 'auto',
  outlineStyle: 'none',
  outlineWidth: '0px',
  outlineColor: 'rgb(0, 0, 0)',
  outlineOffset: '0px',
  boxShadow: 'none',
  borderColor: 'rgb(0, 0, 0)',
  borderWidth: '0px',
};

function element(overrides: Partial<ElementRecord> & { tag: string }): ElementRecord {
  return {
    elemId: elementId('e0'),
    ordinal: 0,
    xpath: '/html[1]/body[1]',
    selector: 'body',
    role: null,
    accessibleName: null,
    bbox: null,
    visible: true,
    focusable: false,
    tabIndex: -1,
    text: null,
    attributes: {},
    style: BLANK_STYLE,
    ...overrides,
  };
}

function capture(overrides: Partial<StateCapture> = {}): StateCapture {
  return {
    pageStateId: pageStateId('st_test'),
    url: 'https://example.com/',
    title: 'Test',
    documentLang: 'en',
    viewport: { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
    layout: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 2000, clientHeight: 900 },
    capturedAt: '2026-07-23T10:00:00.000Z',
    interactionPath: [],
    html: '<html></html>',
    htmlTruncated: false,
    elements: [],
    ariaSnapshot: '',
    axTreeSource: 'cdp',
    artifacts: { fullPage: null, viewport: null },
    consoleErrors: [],
    media: {
      images: 0,
      imagesWithoutAlt: 0,
      decorativeImages: 0,
      svg: 0,
      canvas: 0,
      video: 0,
      audio: 0,
      autoplayingMedia: 0,
      mediaWithCaptionTrack: 0,
      iframes: 0,
      thirdPartyMediaEmbeds: 0,
    },
    degradations: [],
    ...overrides,
  };
}

describe('computePageStateId', () => {
  it('is stable for the same url, viewport and interaction path', () => {
    expect(computePageStateId('https://a.test/', 'desktop', [])).toBe(
      computePageStateId('https://a.test/', 'desktop', []),
    );
  });

  it('separates states that differ in any input', () => {
    const base = computePageStateId('https://a.test/', 'desktop', []);
    expect(computePageStateId('https://a.test/', 'mobile', [])).not.toBe(base);
    expect(computePageStateId('https://a.test/b', 'desktop', [])).not.toBe(base);
    expect(computePageStateId('https://a.test/', 'desktop', ['click #x'])).not.toBe(base);
  });

  it('distinguishes interaction paths that differ only in order', () => {
    // Opening a menu then a dialog is not the same state as the reverse.
    expect(computePageStateId('https://a.test/', 'desktop', ['a', 'b'])).not.toBe(
      computePageStateId('https://a.test/', 'desktop', ['b', 'a']),
    );
  });
});

describe('deriveApplicabilitySignals', () => {
  it('reports presence, never absence', () => {
    const signals = deriveApplicabilitySignals([capture()], 1);

    // An empty page yields all-false. The reference turns most of those into
    // `unknown`, which keeps criteria on the human checklist rather than
    // excusing them — the safe direction to be wrong in.
    expect(signals.hasImages).toBe(false);
    expect(signals.hasPrerecordedVideo).toBe(false);
    expect(signals.pagesInScan).toBe(1);
  });

  it('counts media across every captured state', () => {
    const withImages = capture({ media: { ...capture().media, images: 3 } });
    const withVideo = capture({ media: { ...capture().media, video: 1 } });

    const signals = deriveApplicabilitySignals([withImages, withVideo], 2);
    expect(signals.hasImages).toBe(true);
    expect(signals.hasPrerecordedVideo).toBe(true);
    expect(signals.pagesInScan).toBe(2);
  });

  it('treats a third-party embed as video, since we cannot see inside it', () => {
    const embed = capture({ media: { ...capture().media, thirdPartyMediaEmbeds: 1 } });
    expect(deriveApplicabilitySignals([embed], 1).hasPrerecordedVideo).toBe(true);
  });

  it('detects authentication from a password field', () => {
    const login = capture({
      elements: [element({ tag: 'input', attributes: { type: 'password' } })],
    });
    expect(deriveApplicabilitySignals([login], 1).hasAuthentication).toBe(true);
  });

  it('flags a foreign-language passage against the document language', () => {
    const mixed = capture({
      documentLang: 'en',
      elements: [
        element({ tag: 'p', attributes: { lang: 'fr' } }),
        element({ tag: 'p', attributes: { lang: 'en-GB' } }),
      ],
    });
    // en-GB is the same language as the page; fr is not.
    expect(deriveApplicabilitySignals([mixed], 1).hasForeignLanguagePassages).toBe(true);

    const sameLang = capture({
      documentLang: 'en',
      elements: [element({ tag: 'p', attributes: { lang: 'en-US' } })],
    });
    expect(deriveApplicabilitySignals([sameLang], 1).hasForeignLanguagePassages).toBe(false);
  });

  it('finds a help mechanism from link text or href', () => {
    const byText = capture({ elements: [element({ tag: 'a', text: 'Contact us', attributes: { href: '/c' } })] });
    const byHref = capture({ elements: [element({ tag: 'a', text: 'Reach out', attributes: { href: '/support' } })] });
    const neither = capture({ elements: [element({ tag: 'a', text: 'Menu', attributes: { href: '/menu' } })] });

    expect(deriveApplicabilitySignals([byText], 1).hasHelpMechanism).toBe(true);
    expect(deriveApplicabilitySignals([byHref], 1).hasHelpMechanism).toBe(true);
    expect(deriveApplicabilitySignals([neither], 1).hasHelpMechanism).toBe(false);
  });

  it('leaves time, motion and gesture signals false — a still capture cannot see them', () => {
    const busy = capture({
      elements: [element({ tag: 'div', attributes: { class: 'carousel animated' } })],
    });
    const signals = deriveApplicabilitySignals([busy], 1);

    // Guessing from class names would be worse than admitting we cannot see it:
    // a false `true` here is a finding nobody can act on.
    expect(signals.hasMovingContent).toBe(false);
    expect(signals.hasTimeLimits).toBe(false);
    expect(signals.hasPointerGestures).toBe(false);
    expect(signals.hasFlashingContent).toBe(false);
  });
});

describe('artifact store', () => {
  it('is content-addressed, so identical screenshots are stored once', async () => {
    const store = new MemoryArtifactStore();
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    const first = await store.put(png, 'full');
    const second = await store.put(png, 'full');

    expect(second).toBe(first);
    expect(store.size).toBe(1);
  });

  it('rejects a read for an artifact it does not hold', async () => {
    const store = new MemoryArtifactStore();
    await expect(store.get(elementId('nope') as never)).rejects.toThrow(/no such artifact/);
  });
});

describe('cropToElement', () => {
  const page = () =>
    sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();

  it('cuts the requested region and caps the long edge', async () => {
    const crop = await cropToElement(await page(), { x: 100, y: 100, width: 400, height: 200 });
    const meta = await sharp(crop).metadata();

    expect(meta.width).toBeLessThanOrEqual(300);
    expect(meta.height).toBeLessThanOrEqual(300);
  });

  it('clamps a bbox that runs past the edge of the screenshot', async () => {
    // Lazy scrolling and sticky headers routinely produce boxes that overhang;
    // a crop must degrade to the visible part rather than throw.
    const crop = await cropToElement(await page(), { x: 700, y: 550, width: 400, height: 400 });
    expect((await sharp(crop).metadata()).width).toBeGreaterThan(0);
  });

  it('refuses a bbox that starts outside the screenshot entirely', async () => {
    await expect(
      cropToElement(await page(), { x: 5000, y: 5000, width: 10, height: 10 }),
    ).rejects.toThrow(/falls outside/);
  });

  it('keeps a small element from being upscaled into a blurry crop', async () => {
    const crop = await cropToElement(await page(), { x: 10, y: 10, width: 18, height: 18 });
    const meta = await sharp(crop).metadata();

    // 18px target plus 8px padding each side = 34px. It must stay 34px, not be
    // stretched to the 300px cap.
    expect(meta.width).toBe(34);
  });
});

describe('normaliseForVision', () => {
  it('shrinks a wide screenshot to the token-budgeted width', async () => {
    const wide = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    expect((await sharp(await normaliseForVision(wide)).metadata()).width).toBe(1024);
  });

  it('leaves an already-small screenshot alone', async () => {
    const small = await sharp({
      create: { width: 320, height: 200, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    expect((await sharp(await normaliseForVision(small)).metadata()).width).toBe(320);
  });
});
