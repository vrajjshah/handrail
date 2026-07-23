/**
 * Shared pieces of the seeded-demo capture fixture: the constants that make a
 * capture reproducible, and the anchor reader that joins `ground-truth.json` ids
 * to captured elements.
 *
 * Deliberately side-effect free and kept apart from `capture-seeded-demo.ts`,
 * which runs on import. The browser drift guard imports these — if it imported
 * the runner instead, importing it would regenerate the very file it is meant to
 * be checking, and the guard would pass forever. (It did, once. That is why this
 * file exists.)
 */
import { pageStateId } from '@handrail/schemas';

import { computePageStateId } from '../capture/state-capture.js';
import type { IsolatedWorld } from '../capture/isolated-world.js';
import type { StateCapture } from '../capture/types.js';

/** The URL the committed fixture claims. The real one carries an ephemeral port. */
export const FIXTURE_URL = 'http://localhost:5178/';
/** Frozen so a regeneration with no substantive change produces no diff. */
export const FIXTURE_CAPTURED_AT = '2026-07-23T12:00:00.000Z';

export const DESKTOP = {
  label: 'desktop',
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
} as const;

/** `gt-006` → the xpath of the element `ground-truth.json` points at. */
export type GroundTruthAnchors = Record<string, string>;

/**
 * Reads the `data-gt` / `data-trap` anchors out of the page.
 *
 * The element index deliberately does not collect `data-gt` — it is a fixture
 * convention, not something a scanner should know about — so the eval's
 * ground-truth ids are joined to captured elements by xpath instead. The xpath
 * algorithm here is a copy of the collector's, and it has to stay one: the
 * function is serialised into a separate realm, so it cannot reference anything
 * outside itself.
 */
export async function readGroundTruthAnchors(world: IsolatedWorld): Promise<GroundTruthAnchors> {
  return world.evaluate<null, GroundTruthAnchors>(() => {
    const xpathOf = (el: Element): string => {
      const parts: string[] = [];
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        let index = 1;
        for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
          if (prev.tagName === node.tagName) index += 1;
        }
        parts.unshift(`${node.tagName.toLowerCase()}[${String(index)}]`);
      }
      return `/${parts.join('/')}`;
    };

    const anchors: Record<string, string> = {};
    for (const el of document.querySelectorAll('[data-gt], [data-trap]')) {
      const id = el.getAttribute('data-gt') ?? el.getAttribute('data-trap');
      if (id !== null) anchors[id] = xpathOf(el);
    }
    return anchors;
  }, null);
}

/** Strip the ephemeral origin and the wall clock so the committed file is stable. */
export function normalizeCapture(capture: StateCapture, origin: string): StateCapture {
  const replaced = JSON.parse(
    JSON.stringify(capture).split(origin).join(FIXTURE_URL.replace(/\/$/, '')),
  ) as StateCapture;

  return {
    ...replaced,
    url: FIXTURE_URL,
    capturedAt: FIXTURE_CAPTURED_AT,
    pageStateId: pageStateId(computePageStateId(FIXTURE_URL, DESKTOP.label, [])),
  };
}
