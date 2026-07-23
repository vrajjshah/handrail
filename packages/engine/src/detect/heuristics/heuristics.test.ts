import { elementId, pageStateId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import type { ElementRecord, StateCapture } from '../../capture/types.js';
import { analyzeFocusOrder } from './kbd-focus-order.js';
import { analyzeFocusVisible } from './kbd-focus-visible.js';
import type { KeyboardTraversal, TraversalStop } from './keyboard-traversal.js';
import { analyzeReflow } from './resp-reflow.js';
import { analyzeHeuristics } from './run-heuristics.js';
import { analyzeTargetSize } from './ptr-target-size.js';
import type { FocusStyle } from './read-active-element.browser.js';

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

let counter = 0;
function element(overrides: Partial<ElementRecord> = {}): ElementRecord {
  counter += 1;
  const xpath = overrides.xpath ?? `/html[1]/body[1]/div[${String(counter)}]`;
  return {
    elemId: elementId(`e${String(counter)}`),
    ordinal: counter,
    xpath,
    selector: xpath,
    tag: 'button',
    role: 'button',
    accessibleName: 'Control',
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    visible: true,
    focusable: true,
    tabIndex: 0,
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
      images: 0, imagesWithoutAlt: 0, decorativeImages: 0, svg: 0, canvas: 0, video: 0,
      audio: 0, autoplayingMedia: 0, mediaWithCaptionTrack: 0, iframes: 0, thirdPartyMediaEmbeds: 0,
    },
    degradations: [],
    ...overrides,
  };
}

const RING: FocusStyle = {
  outlineStyle: 'solid',
  outlineWidth: '3px',
  outlineColor: 'rgb(18, 80, 122)',
  boxShadow: 'none',
  borderColor: 'rgb(0, 0, 0)',
  borderWidth: '0px',
  backgroundColor: 'rgba(0, 0, 0, 0)',
};
const NO_RING: FocusStyle = { ...RING, outlineStyle: 'none', outlineWidth: '0px' };

function traversalOf(stops: { element: ElementRecord; focusStyle: FocusStyle }[]): KeyboardTraversal {
  return {
    stops: stops.map(
      (s, order): TraversalStop => ({
        xpath: s.element.xpath,
        tag: s.element.tag,
        order,
        focusStyle: s.focusStyle,
      }),
    ),
    truncated: false,
  };
}

describe('analyzeTargetSize', () => {
  it('flags an undersized target crowded against a neighbour', () => {
    const small = element({ bbox: { x: 0, y: 0, width: 18, height: 18 } });
    const neighbour = element({ bbox: { x: 18, y: 0, width: 40, height: 40 } });
    const outcome = analyzeTargetSize(capture({ elements: [small, neighbour] }));

    // The small one fails; the full-size neighbour passes on size.
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.element?.elementId).toBe(small.elemId);
    expect(outcome.findings[0]!.scPrimary).toBe('2.5.8');
    const pixels = outcome.findings[0]!.evidence.find((e) => e.kind === 'pixels');
    expect(pixels).toMatchObject({ metric: 'target-size-px', measured: 18, threshold: 24 });
  });

  it('does NOT flag an isolated undersized target — the spacing exception applies', () => {
    // Nearest other target is 200px away: the 24px circle intersects nothing.
    const small = element({ bbox: { x: 0, y: 0, width: 18, height: 18 } });
    const far = element({ bbox: { x: 200, y: 200, width: 40, height: 40 } });
    expect(analyzeTargetSize(capture({ elements: [small, far] })).findings).toEqual([]);
  });

  it('does NOT flag an inline undersized target — a link in a run of text', () => {
    const inline = element({
      tag: 'a',
      attributes: { href: '/x' },
      style: { ...BLANK_STYLE, display: 'inline' },
      bbox: { x: 0, y: 0, width: 18, height: 16 },
    });
    const crowder = element({ bbox: { x: 18, y: 0, width: 40, height: 40 } });
    expect(analyzeTargetSize(capture({ elements: [inline, crowder] })).findings).toEqual([]);
  });

  it('does NOT flag a target that meets the 24px minimum', () => {
    const ok = element({ bbox: { x: 0, y: 0, width: 24, height: 24 } });
    const neighbour = element({ bbox: { x: 24, y: 0, width: 24, height: 24 } });
    expect(analyzeTargetSize(capture({ elements: [ok, neighbour] })).findings).toEqual([]);
  });

  it('ignores non-interactive elements', () => {
    const paragraph = element({ tag: 'p', role: null, focusable: false, bbox: { x: 0, y: 0, width: 10, height: 10 } });
    const outcome = analyzeTargetSize(capture({ elements: [paragraph] }));
    expect(outcome.candidatesChecked).toBe(0);
    expect(outcome.findings).toEqual([]);
  });
});

describe('analyzeReflow', () => {
  const narrow = { label: 'reflow-320' as const, width: 320, height: 800, deviceScaleFactor: 1 };

  it('flags an element wider than the viewport when the page scrolls horizontally', () => {
    const table = element({ tag: 'table', bbox: { x: 0, y: 0, width: 720, height: 200 } });
    const outcome = analyzeReflow(
      capture({
        viewport: narrow,
        layout: { scrollWidth: 720, clientWidth: 320, scrollHeight: 1000, clientHeight: 800 },
        elements: [table],
      }),
    );

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.element?.elementId).toBe(table.elemId);
    expect(outcome.findings[0]!.scPrimary).toBe('1.4.10');
  });

  it('reports only the outermost overflowing element, not its wide descendants', () => {
    const table = element({ xpath: '/html[1]/body[1]/table[1]', tag: 'table', bbox: { x: 0, y: 0, width: 720, height: 200 } });
    const cell = element({ xpath: '/html[1]/body[1]/table[1]/tr[1]/td[1]', tag: 'td', bbox: { x: 0, y: 0, width: 700, height: 40 } });
    const outcome = analyzeReflow(
      capture({
        viewport: narrow,
        layout: { scrollWidth: 720, clientWidth: 320, scrollHeight: 1000, clientHeight: 800 },
        elements: [table, cell],
      }),
    );
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.element?.elementId).toBe(table.elemId);
  });

  it('passes when the page reflows cleanly at 320px', () => {
    const outcome = analyzeReflow(
      capture({
        viewport: narrow,
        layout: { scrollWidth: 320, clientWidth: 320, scrollHeight: 1000, clientHeight: 800 },
        elements: [element({ bbox: { x: 0, y: 0, width: 300, height: 40 } })],
      }),
    );
    expect(outcome.findings).toEqual([]);
    expect(outcome.candidatesChecked).toBe(1);
  });

  it('does not apply at a desktop viewport', () => {
    const outcome = analyzeReflow(
      capture({
        // Desktop: layout genuinely has wide content, but 1.4.10 is a 320px check.
        layout: { scrollWidth: 2000, clientWidth: 1440, scrollHeight: 1000, clientHeight: 900 },
        elements: [element({ bbox: { x: 0, y: 0, width: 1800, height: 40 } })],
      }),
    );
    expect(outcome.findings).toEqual([]);
    expect(outcome.candidatesChecked).toBe(0);
  });
});

describe('analyzeFocusOrder', () => {
  it('flags a control a positive tabindex pulls ahead of an earlier one', () => {
    const menu = element({ ordinal: 1, tabIndex: 3, accessibleName: 'Menu' });
    const cellar = element({ ordinal: 2, tabIndex: 4, accessibleName: 'Cellar' });
    const contact = element({ ordinal: 3, tabIndex: 2, accessibleName: 'Contact' });

    // tabindex order: Contact(2), Menu(3), Cellar(4) — Contact jumps the queue.
    const traversal = traversalOf([
      { element: contact, focusStyle: RING },
      { element: menu, focusStyle: RING },
      { element: cellar, focusStyle: RING },
    ]);
    const outcome = analyzeFocusOrder(capture({ elements: [menu, cellar, contact] }), traversal);

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.element?.accessibleName).toBe('Contact');
    expect(outcome.findings[0]!.scPrimary).toBe('2.4.3');
  });

  it('passes when tab order matches document order, even with positive tabindex', () => {
    const a = element({ ordinal: 1, tabIndex: 1, accessibleName: 'A' });
    const b = element({ ordinal: 2, tabIndex: 2, accessibleName: 'B' });
    const traversal = traversalOf([
      { element: a, focusStyle: RING },
      { element: b, focusStyle: RING },
    ]);
    expect(analyzeFocusOrder(capture({ elements: [a, b] }), traversal).findings).toEqual([]);
  });

  it('does not flag a natural (tabindex 0) tab order', () => {
    const a = element({ ordinal: 1, accessibleName: 'A' });
    const b = element({ ordinal: 2, accessibleName: 'B' });
    const traversal = traversalOf([
      { element: a, focusStyle: RING },
      { element: b, focusStyle: RING },
    ]);
    expect(analyzeFocusOrder(capture({ elements: [a, b] }), traversal).findings).toEqual([]);
  });
});

describe('analyzeFocusVisible', () => {
  it('flags a control that shows no indicator on focus', () => {
    const button = element({ accessibleName: 'Join the list' });
    const traversal = traversalOf([{ element: button, focusStyle: NO_RING }]);
    const outcome = analyzeFocusVisible(capture({ elements: [button] }), traversal);

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.scPrimary).toBe('2.4.7');
    const pixels = outcome.findings[0]!.evidence.find((e) => e.kind === 'pixels');
    expect(pixels).toMatchObject({ metric: 'focus-indicator-delta', measured: 0 });
  });

  it('passes a control that shows an outline on focus', () => {
    const button = element();
    const traversal = traversalOf([{ element: button, focusStyle: RING }]);
    expect(analyzeFocusVisible(capture({ elements: [button] }), traversal).findings).toEqual([]);
  });

  it('passes a control that swaps its box-shadow on focus instead of an outline', () => {
    const button = element();
    const shadow: FocusStyle = { ...NO_RING, boxShadow: 'rgb(18, 80, 122) 0px 0px 0px 3px' };
    const traversal = traversalOf([{ element: button, focusStyle: shadow }]);
    expect(analyzeFocusVisible(capture({ elements: [button] }), traversal).findings).toEqual([]);
  });
});

describe('analyzeHeuristics', () => {
  it('runs every check and aggregates outcomes', () => {
    const result = analyzeHeuristics(capture(), traversalOf([]));
    expect(result.outcomes.map((o) => o.checkId).sort()).toEqual([
      'kbd.focus-visible',
      'kbd.walk',
      'ptr.target-size',
      'resp.reflow-320',
    ]);
  });

  it('records a degradation when the tab walk was truncated', () => {
    const result = analyzeHeuristics(capture(), { stops: [], truncated: true });
    expect(result.degradations).toHaveLength(1);
    expect(result.degradations[0]!.detail).toMatch(/partial/);
  });
});
