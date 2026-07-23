import type { Page } from 'playwright';

import { IsolatedWorld } from '../../capture/isolated-world.js';
import { readActiveElement, type ActiveElementInfo } from './read-active-element.browser.js';

export interface TraversalStop extends ActiveElementInfo {
  /** 0-based position in the tab sequence. */
  order: number;
}

export interface KeyboardTraversal {
  stops: TraversalStop[];
  /** True if the sequence hit the stop cap before completing — order is partial. */
  truncated: boolean;
}

/** The plan caps a tab walk at 200 stops; a real page rarely needs a fraction. */
const MAX_STOPS = 200;

/**
 * Walks the real tab order by pressing Tab, recording each focused element and
 * its focused computed style.
 *
 * **Real key presses, not scripted focus.** Two behaviours only appear under
 * genuine keyboard interaction and are exactly what the keyboard checks need:
 * the tab *sequence* (which `element.focus()` cannot reproduce), and
 * `:focus-visible`, which the user-agent matches on keyboard focus but not
 * always on a programmatic `.focus()`. The fixture's own keyboard trap is the
 * reminder that synthetic focus events lie.
 *
 * One traversal serves both `kbd.walk` and `kbd.focus-visible`, so the page is
 * tabbed through once rather than once per check.
 */
export async function keyboardTraversal(page: Page): Promise<KeyboardTraversal> {
  // Start from a clean slate so the first Tab lands on the first focusable.
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active !== null) active.blur();
  });

  const world = await IsolatedWorld.create(page, 'handrail-kbd');
  const stops: TraversalStop[] = [];
  const seen = new Set<string>();
  let truncated = false;

  try {
    for (let order = 0; order < MAX_STOPS; order += 1) {
      await page.keyboard.press('Tab');
      const active = await world.evaluate(readActiveElement, undefined);

      // Focus left the document, or hit browser chrome — the walk is done.
      if (active === null) break;

      // Focus cycled back to somewhere already visited: a full loop.
      if (seen.has(active.xpath)) break;

      seen.add(active.xpath);
      stops.push({ ...active, order });

      if (order === MAX_STOPS - 1) truncated = true;
    }
  } finally {
    await world.dispose();
  }

  return { stops, truncated };
}
