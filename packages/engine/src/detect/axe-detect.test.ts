import { elementId, pageStateId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import type { ElementRecord, StateCapture } from '../capture/types.js';
import { mapAxeResult } from './axe-detect.js';
import type { EnrichedAxeGroup, EnrichedAxeNode, EnrichedAxeResult } from './types.js';

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

function element(overrides: Partial<ElementRecord> & { xpath: string }): ElementRecord {
  return {
    elemId: elementId(`e_${overrides.xpath}`),
    ordinal: 0,
    selector: overrides.xpath,
    tag: 'div',
    role: null,
    accessibleName: null,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    visible: true,
    focusable: false,
    tabIndex: -1,
    text: null,
    attributes: {},
    style: BLANK_STYLE,
    ...overrides,
  };
}

function capture(elements: ElementRecord[]): StateCapture {
  return {
    pageStateId: pageStateId('st_fixed'),
    url: 'https://example.com/',
    title: 'Test',
    documentLang: null,
    viewport: { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
    layout: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 2000, clientHeight: 900 },
    capturedAt: '2026-07-23T10:00:00.000Z',
    interactionPath: [],
    html: '<html></html>',
    htmlTruncated: false,
    elements,
    ariaSnapshot: '',
    axTreeSource: 'cdp',
    artifacts: { fullPage: null, viewport: null },
    consoleErrors: [],
    media: {
      images: 0, imagesWithoutAlt: 0, decorativeImages: 0, svg: 0, canvas: 0, video: 0,
      audio: 0, autoplayingMedia: 0, mediaWithCaptionTrack: 0, iframes: 0, thirdPartyMediaEmbeds: 0,
    },
    degradations: [],
  };
}

function node(overrides: Partial<EnrichedAxeNode> & { target: string[] }): EnrichedAxeNode {
  return {
    html: `<div>${overrides.target.join('')}</div>`,
    impact: 'serious',
    xpath: null,
    any: [],
    all: [],
    none: [],
    ...overrides,
  };
}

function group(overrides: Partial<EnrichedAxeGroup> & { id: string }): EnrichedAxeGroup {
  return {
    impact: 'serious',
    tags: [],
    help: `${overrides.id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.12/${overrides.id}`,
    description: `${overrides.id} description`,
    nodes: [],
    ...overrides,
  };
}

/** The installed axe version, so the mapper's stamp check passes in tests. */
import axe from 'axe-core';
const AXE_VERSION = axe.version;

function result(overrides: Partial<EnrichedAxeResult> = {}): EnrichedAxeResult {
  return { axeVersion: AXE_VERSION, violations: [], incomplete: [], passes: [], ...overrides };
}

describe('violations', () => {
  it('become violation-tier findings with tool evidence and the mapped criterion', () => {
    const state = capture([element({ xpath: '/html[1]/body[1]/img[1]', tag: 'img' })]);
    const detection = mapAxeResult(
      result({
        violations: [
          group({
            id: 'image-alt',
            impact: 'critical',
            nodes: [
              node({
                target: ['img'],
                xpath: '/html[1]/body[1]/img[1]',
                any: [{ id: 'has-alt', message: 'Element does not have an alt attribute' }],
              }),
            ],
          }),
        ],
      }),
      state,
    );

    expect(detection.findings).toHaveLength(1);
    const finding = detection.findings[0]!;
    expect(finding.source).toEqual(['axe']);
    expect(finding.tier).toBe('violation');
    expect(finding.severity).toBe('critical');
    expect(finding.checkId).toBe('axe.image-alt');
    expect(finding.scPrimary).toBe('1.1.1');
    expect(finding.confidence).toBe(1);

    const toolEvidence = finding.evidence.find((e) => e.kind === 'tool');
    expect(toolEvidence).toMatchObject({
      tool: 'axe-core',
      ruleId: 'image-alt',
      output: 'Element does not have an alt attribute',
    });
  });

  it('ground to the element index when the xpath resolves', () => {
    const state = capture([
      element({
        xpath: '/html[1]/body[1]/img[1]',
        tag: 'img',
        selector: '#hero',
        bbox: { x: 5, y: 5, width: 100, height: 40 },
        accessibleName: 'A cat',
        role: 'image',
      }),
    ]);
    const detection = mapAxeResult(
      result({
        violations: [
          group({ id: 'image-alt', nodes: [node({ target: ['img'], xpath: '/html[1]/body[1]/img[1]' })] }),
        ],
      }),
      state,
    );

    const finding = detection.findings[0]!;
    expect(finding.element?.elementId).toBe('e_/html[1]/body[1]/img[1]');
    expect(finding.element?.selector).toBe('#hero');
    expect(finding.element?.bbox).toEqual({ x: 5, y: 5, width: 100, height: 40 });
    expect(finding.element?.accessibleName).toBe('A cat');
  });

  it('still report an ungrounded node, and record it as degraded', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({ violations: [group({ id: 'image-alt', nodes: [node({ target: ['img'], xpath: null })] })] }),
      state,
    );

    expect(detection.findings).toHaveLength(1);
    // Falls back to the axe target for the selector rather than dropping the finding.
    expect(detection.findings[0]!.element?.selector).toBe('img');
    expect(detection.degradations).toContainEqual(
      expect.objectContaining({ reason: 'ungrounded-node' }),
    );
  });

  it('default a null impact to moderate severity', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({ violations: [group({ id: 'image-alt', impact: null, nodes: [node({ target: ['img'] })] })] }),
      state,
    );
    expect(detection.findings[0]!.severity).toBe('moderate');
  });
});

describe('contrast findings carry measured pixel evidence', () => {
  it('turns axe contrast data into deterministic pixel evidence, not a model claim', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({
        violations: [
          group({
            id: 'color-contrast',
            nodes: [
              node({
                target: ['p'],
                any: [
                  {
                    id: 'color-contrast',
                    message: 'insufficient contrast of 3.03',
                    data: {
                      fgColor: '#949494',
                      bgColor: '#ffffff',
                      contrastRatio: 3.03,
                      expectedContrastRatio: '4.5:1',
                      fontSize: '12pt',
                      fontWeight: 'normal',
                    },
                  },
                ],
              }),
            ],
          }),
        ],
      }),
      state,
    );

    const pixels = detection.findings[0]!.evidence.find((e) => e.kind === 'pixels');
    expect(pixels).toEqual({
      kind: 'pixels',
      metric: 'contrast-ratio',
      measured: 3.03,
      threshold: 4.5,
      comparator: 'gte',
    });
  });
});

describe('incomplete results', () => {
  it('become needs-review, because axe could not decide and neither do we', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({
        incomplete: [
          group({
            id: 'color-contrast',
            nodes: [node({ target: ['div'], any: [{ id: 'color-contrast', message: 'unable to determine' }] })],
          }),
        ],
      }),
      state,
    );

    expect(detection.findings).toHaveLength(1);
    expect(detection.findings[0]!.tier).toBe('needs-review');
  });
});

describe('rules outside our target', () => {
  it('skips a rule that maps to no A/AA criterion we track', () => {
    const state = capture([]);
    // `region` is an axe best-practice rule with no WCAG tag.
    const detection = mapAxeResult(
      result({ violations: [group({ id: 'region', nodes: [node({ target: ['body'] })] })] }),
      state,
    );

    expect(detection.findings).toHaveLength(0);
  });

  it('skips the obsolete duplicate-id rule that only maps to removed 4.1.1', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({ violations: [group({ id: 'duplicate-id', nodes: [node({ target: ['#x'] })] })] }),
      state,
    );
    expect(detection.findings).toHaveLength(0);
  });
});

describe('passes', () => {
  it('are carried as positive evidence, not turned into findings', () => {
    const state = capture([]);
    const detection = mapAxeResult(
      result({ passes: [{ id: 'html-has-lang', nodeCount: 1 }, { id: 'region', nodeCount: 3 }] }),
      state,
    );

    expect(detection.findings).toHaveLength(0);
    // html-has-lang maps to 3.1.1; region maps to nothing and is dropped.
    expect(detection.passes).toEqual([
      { ruleId: 'html-has-lang', checkId: 'axe.html-has-lang', sc: ['3.1.1'], nodeCount: 1 },
    ]);
  });
});

describe('determinism and integrity', () => {
  it('produces identical output for identical input', () => {
    const state = capture([element({ xpath: '/html[1]/body[1]/img[1]', tag: 'img' })]);
    const input = result({
      violations: [group({ id: 'image-alt', nodes: [node({ target: ['img'], xpath: '/html[1]/body[1]/img[1]' })] })],
    });

    expect(mapAxeResult(input, state)).toEqual(mapAxeResult(input, state));
  });

  it('flags a version mismatch rather than trusting a stale attribution', () => {
    const state = capture([]);
    const detection = mapAxeResult(result({ axeVersion: '9.9.9' }), state);
    expect(detection.degradations).toContainEqual(
      expect.objectContaining({ reason: 'axe-version-mismatch' }),
    );
  });
});
