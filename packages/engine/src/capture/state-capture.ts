import { createHash } from 'node:crypto';

import {
  elementId,
  pageStateId,
  type Viewport,
  type ViewportLabel,
} from '@handrail/schemas';
import type { Page } from 'playwright';

import type { ArtifactStore } from './artifacts.js';
import { readAxTree } from './ax-tree.js';
import { collectElementIndex, type RawCollectorResult } from './element-index.browser.js';
import { IsolatedWorld } from './isolated-world.js';
import {
  StateCaptureSchema,
  type CaptureDegradation,
  type ConsoleError,
  type ElementRecord,
  type StateCapture,
} from './types.js';

export interface CaptureOptions {
  viewport: Viewport;
  /** Where screenshots go. Omit to skip them entirely — deterministic-mode scans do. */
  artifacts?: ArtifactStore;
  /** How this state was reached, when it took interaction rather than a URL. */
  interactionPath?: readonly string[];
  maxElements?: number;
  maxTextLength?: number;
  /** Cap on the stored HTML snapshot. */
  maxHtmlLength?: number;
}

const DEFAULTS = {
  maxElements: 4000,
  maxTextLength: 200,
  maxHtmlLength: 2_000_000,
} as const;

/**
 * A recorder for page console output.
 *
 * Attach it **before** navigating: console messages that fire during load are
 * gone by the time a capture starts, and those are exactly the ones worth having
 * — a framework warning about a duplicate id or an invalid ARIA attribute often
 * explains a finding better than the finding does.
 */
export class ConsoleRecorder {
  private readonly entries: ConsoleError[] = [];
  private readonly limit: number;

  constructor(page: Page, limit = 100) {
    this.limit = limit;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      this.push({ type: 'error', text: message.text() });
    });
    page.on('pageerror', (error) => {
      this.push({ type: 'pageerror', text: error.message });
    });
    page.on('requestfailed', (request) => {
      this.push({
        type: 'requestfailed',
        text: `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`,
      });
    });
  }

  private push(entry: ConsoleError): void {
    if (this.entries.length < this.limit) this.entries.push(entry);
  }

  drain(): ConsoleError[] {
    return [...this.entries];
  }
}

/**
 * Derives a stable id for a page state.
 *
 * Deterministic rather than random so that re-capturing the same page in the same
 * viewport produces the same id — which is what lets the golden-scan snapshot diff
 * mean something, and what makes a judgment cache hit on a re-scan.
 */
export function computePageStateId(
  url: string,
  viewportLabel: ViewportLabel,
  interactionPath: readonly string[],
): string {
  const digest = createHash('sha256')
    .update([url, viewportLabel, ...interactionPath].join('|'))
    .digest('hex')
    .slice(0, 16);
  return `st_${digest}`;
}

/**
 * Captures one page state: capture once, judge many.
 *
 * Every detection layer reads from the result rather than driving the browser
 * itself, so a page is loaded and measured exactly once per viewport however many
 * checks consume it. Nothing here mutates the target page — the element index is
 * collected from a CDP isolated world, and roles and accessible names come from
 * Chromium's own accessibility tree.
 *
 * Failures degrade rather than throw: a capture that could not take a screenshot
 * is still a usable capture, and it says so in `degradations` so nothing
 * downstream mistakes a partial capture for a clean one.
 */
export async function captureState(
  page: Page,
  options: CaptureOptions,
  console_?: ConsoleRecorder,
): Promise<StateCapture> {
  const maxElements = options.maxElements ?? DEFAULTS.maxElements;
  const maxTextLength = options.maxTextLength ?? DEFAULTS.maxTextLength;
  const maxHtmlLength = options.maxHtmlLength ?? DEFAULTS.maxHtmlLength;
  const interactionPath = [...(options.interactionPath ?? [])];
  const degradations: CaptureDegradation[] = [];

  const world = await IsolatedWorld.create(page);
  try {
    const collected: RawCollectorResult = await world.evaluate(collectElementIndex, {
      maxElements,
      maxTextLength,
    });

    if (collected.capped) {
      degradations.push({
        reason: 'element-cap-reached',
        detail: `page has ${String(collected.totalElements)} elements; indexed the first ${String(maxElements)}`,
      });
    }

    let axIndex: ReadonlyMap<string, { role: string; name: string }> = new Map();
    let axTreeSource: StateCapture['axTreeSource'] = 'cdp';
    try {
      axIndex = await readAxTree(world.session);
    } catch (error) {
      axTreeSource = 'unavailable';
      degradations.push({
        reason: 'ax-tree-unavailable',
        detail: `roles and accessible names are missing: ${(error as Error).message}`,
      });
    }

    const elements: ElementRecord[] = collected.elements.map((raw) => {
      const ax = axIndex.get(raw.xpath);
      return {
        elemId: elementId(`e${String(raw.ordinal)}`),
        ordinal: raw.ordinal,
        xpath: raw.xpath,
        selector: raw.selector,
        tag: raw.tag,
        role: ax?.role ?? null,
        accessibleName: ax?.name ?? null,
        bbox: raw.bbox,
        visible: raw.visible,
        focusable: raw.focusable,
        tabIndex: raw.tabIndex,
        text: raw.text,
        attributes: raw.attributes,
        style: raw.style as ElementRecord['style'],
      };
    });

    const rawHtml = await page.content();
    const htmlTruncated = rawHtml.length > maxHtmlLength;

    let ariaSnapshot = '';
    try {
      ariaSnapshot = await page.locator('body').ariaSnapshot();
    } catch {
      // A body-less document (or a mid-navigation page) has no ARIA snapshot;
      // the element index still carries roles from the accessibility tree.
    }

    const artifacts = await captureScreenshots(page, options, degradations);

    const capture: StateCapture = {
      pageStateId: pageStateId(
        computePageStateId(page.url(), options.viewport.label, interactionPath),
      ),
      url: page.url(),
      title: collected.title,
      documentLang: collected.documentLang,
      viewport: options.viewport,
      capturedAt: new Date().toISOString(),
      interactionPath,
      html: htmlTruncated ? rawHtml.slice(0, maxHtmlLength) : rawHtml,
      htmlTruncated,
      elements,
      ariaSnapshot,
      axTreeSource,
      artifacts,
      consoleErrors: console_?.drain() ?? [],
      media: collected.media,
      degradations,
    };

    if (htmlTruncated) {
      degradations.push({
        reason: 'dom-truncated',
        detail: `DOM snapshot exceeded ${String(maxHtmlLength)} characters`,
      });
    }

    return StateCaptureSchema.parse(capture);
  } finally {
    await world.dispose();
  }
}

async function captureScreenshots(
  page: Page,
  options: CaptureOptions,
  degradations: CaptureDegradation[],
): Promise<StateCapture['artifacts']> {
  if (options.artifacts === undefined) return { fullPage: null, viewport: null };

  try {
    const [fullPagePng, viewportPng] = await Promise.all([
      page.screenshot({ fullPage: true, animations: 'disabled' }),
      page.screenshot({ fullPage: false, animations: 'disabled' }),
    ]);
    return {
      fullPage: await options.artifacts.put(fullPagePng, 'full'),
      viewport: await options.artifacts.put(viewportPng, 'view'),
    };
  } catch (error) {
    degradations.push({
      reason: 'screenshot-failed',
      detail: (error as Error).message,
    });
    return { fullPage: null, viewport: null };
  }
}
