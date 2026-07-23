import type { CheckId, Evidence } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../../capture/types.js';
import { buildHeuristicFinding, domEvidenceFor } from './finding-builder.js';
import type { KeyboardTraversal } from './keyboard-traversal.js';
import type { HeuristicOutcome } from './types.js';

const CHECK_ID = 'kbd.walk' as CheckId;
const SC: readonly KnownScId[] = ['2.4.3'];

interface ResolvedStop {
  order: number;
  element: ElementRecord;
}

function label(element: ElementRecord): string {
  return element.accessibleName ?? element.text ?? element.selector;
}

/**
 * `kbd.walk` — WCAG 2.4.3 Focus Order.
 *
 * Reads the *real* tab sequence (from the keyboard traversal) and flags elements
 * that jump the queue: a control given a positive `tabindex` that pulls it in
 * front of a control which precedes it in the document. That reordering is what
 * makes the tab order stop matching the reading order — the actual 2.4.3 failure,
 * and one that reading the DOM in source order cannot see.
 *
 * Pure over the traversal, so it is unit-testable without a browser; only
 * producing the traversal needs one.
 */
export function analyzeFocusOrder(
  capture: StateCapture,
  traversal: KeyboardTraversal,
): HeuristicOutcome {
  const byXpath = new Map(capture.elements.map((el) => [el.xpath, el]));

  const resolved: ResolvedStop[] = [];
  for (const stop of traversal.stops) {
    const element = byXpath.get(stop.xpath);
    if (element !== undefined) resolved.push({ order: stop.order, element });
  }

  const findings = resolved
    .filter((stop, index) => {
      if (stop.element.tabIndex <= 0) return false;
      // Did any control focused *later* precede this one in the document? If so,
      // this element was pulled ahead of it — the reordering 2.4.3 is about.
      return resolved
        .slice(index + 1)
        .some((later) => later.element.ordinal < stop.element.ordinal);
    })
    .map((stop) => {
      const focusOrder = resolved
        .map((s) => `${label(s.element)} (tabindex=${String(s.element.tabIndex)})`)
        .join(' → ');
      const evidence: Evidence[] = [
        {
          kind: 'tool',
          tool: 'playwright',
          output:
            `Tab order: ${focusOrder}. "${label(stop.element)}" (tabindex=${String(stop.element.tabIndex)}) ` +
            `receives focus before a control that precedes it in the document.`,
        },
        domEvidenceFor(stop.element),
      ];
      return buildHeuristicFinding(
        {
          checkId: CHECK_ID,
          element: stop.element,
          sc: SC,
          tier: 'violation',
          severity: 'moderate',
          description:
            `A positive tabindex pulls "${label(stop.element)}" out of order: it takes focus ahead of ` +
            `a control that comes before it in the document, so the tab sequence no longer matches the reading order.`,
          evidence,
        },
        capture,
      );
    });

  return { checkId: CHECK_ID, sc: SC, findings, candidatesChecked: resolved.length };
}
