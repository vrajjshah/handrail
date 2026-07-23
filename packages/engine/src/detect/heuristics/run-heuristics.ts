import type { Page } from 'playwright';

import type { StateCapture } from '../../capture/types.js';
import { analyzeFocusOrder } from './kbd-focus-order.js';
import { analyzeFocusVisible } from './kbd-focus-visible.js';
import { keyboardTraversal, type KeyboardTraversal } from './keyboard-traversal.js';
import { analyzeReflow } from './resp-reflow.js';
import { analyzeTargetSize } from './ptr-target-size.js';
import type { HeuristicResult } from './types.js';

/**
 * Runs the pure heuristics over a capture and a keyboard traversal.
 *
 * Separated from the browser step so the whole analysis is unit-testable: feed a
 * capture and a synthetic traversal, assert the findings. Each analyzer decides
 * its own applicability — `resp.reflow-320` only fires at the narrow viewport,
 * `kbd.*` only where the traversal reached elements — so this can run over any
 * capture and the irrelevant checks simply return nothing.
 */
export function analyzeHeuristics(
  capture: StateCapture,
  traversal: KeyboardTraversal,
): HeuristicResult {
  const outcomes = [
    analyzeFocusOrder(capture, traversal),
    analyzeFocusVisible(capture, traversal),
    analyzeTargetSize(capture),
    analyzeReflow(capture),
  ];

  const degradations = traversal.truncated
    ? [
        {
          reason: 'ungrounded-node' as const,
          detail: `keyboard walk hit the ${String(traversal.stops.length)}-stop cap; focus order is partial`,
        },
      ]
    : [];

  return { outcomes, degradations };
}

/**
 * Runs the heuristic layer against a captured state.
 *
 * Walks the real tab order first (the only browser-dependent part), then hands
 * the traversal and the capture to the pure analyzers. Like the axe layer, this
 * reads a page Handrail has already captured — but unlike axe it does drive the
 * keyboard, so run it on a fresh navigation or after the capture, not before the
 * element index is taken.
 */
export async function runHeuristics(page: Page, capture: StateCapture): Promise<HeuristicResult> {
  const traversal = await keyboardTraversal(page);
  return analyzeHeuristics(capture, traversal);
}
