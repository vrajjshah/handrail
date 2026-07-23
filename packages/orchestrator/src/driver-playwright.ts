import {
  ConsoleRecorder,
  captureState,
  runAxeDetection,
  runHeuristics,
  type AxeDetectionResult,
  type Browser,
  type BrowserContext,
  type HeuristicResult,
  type Page,
  type StateCapture,
} from '@handrail/engine';
import type { PageStateId } from '@handrail/schemas';

import type { CaptureRequest, ScanDriver } from './driver.js';

export interface PlaywrightDriverOptions {
  /** How long to wait for a page to settle. */
  navigationTimeoutMs?: number;
  /** Playwright's load condition. `networkidle` is what the engine's own suites use. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

const DEFAULTS = {
  navigationTimeoutMs: 30_000,
  waitUntil: 'networkidle',
} as const;

interface OpenPage {
  context: BrowserContext;
  page: Page;
}

/**
 * The real driver: one browser context per captured state.
 *
 * Every method is a one-line call into an engine step. That is the layering rule
 * of this package in miniature — the graph decides *when* a page is captured and
 * in what order the detection layers run over it, and the engine decides what
 * capturing and detecting mean.
 *
 * A context per state rather than a page per state, because the viewport is a
 * context-level setting and two states of the same URL differ by viewport. They
 * are closed as detection finishes with them, so a crawl holds one page open at
 * a time rather than one per state.
 */
export function createPlaywrightDriver(
  browser: Browser,
  options: PlaywrightDriverOptions = {},
): ScanDriver {
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs;
  const waitUntil = options.waitUntil ?? DEFAULTS.waitUntil;
  const open = new Map<PageStateId, OpenPage>();

  function pageFor(capture: StateCapture): Page {
    const session = open.get(capture.pageStateId);
    if (session === undefined) {
      throw new Error(
        `no open page for ${String(capture.pageStateId)}; detection must run before the state is released`,
      );
    }
    return session.page;
  }

  return {
    async capture(request: CaptureRequest): Promise<StateCapture> {
      const context = await browser.newContext({
        viewport: { width: request.viewport.width, height: request.viewport.height },
        deviceScaleFactor: request.viewport.deviceScaleFactor,
      });
      const page = await context.newPage();
      try {
        // Attached before navigating: the console errors worth having are the
        // ones that fire during load, and they are gone by the time a capture starts.
        const recorder = new ConsoleRecorder(page);
        await page.goto(request.url, { waitUntil, timeout: navigationTimeoutMs });

        const captured = await captureState(
          page,
          { viewport: request.viewport, ...(request.artifacts ? { artifacts: request.artifacts } : {}) },
          recorder,
        );
        open.set(captured.pageStateId, { context, page });
        return captured;
      } catch (error) {
        await context.close();
        throw error;
      }
    },

    axe(capture: StateCapture): Promise<AxeDetectionResult> {
      return runAxeDetection(pageFor(capture), capture);
    },

    heuristics(capture: StateCapture): Promise<HeuristicResult> {
      return runHeuristics(pageFor(capture), capture);
    },

    async release(capture: StateCapture): Promise<void> {
      const session = open.get(capture.pageStateId);
      if (session === undefined) return;
      open.delete(capture.pageStateId);
      await session.context.close();
    },

    async dispose(): Promise<void> {
      const sessions = [...open.values()];
      open.clear();
      await Promise.all(sessions.map((session) => session.context.close()));
    },
  };
}
