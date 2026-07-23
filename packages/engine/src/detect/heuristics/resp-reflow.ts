import type { CheckId, Evidence } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../../capture/types.js';
import { buildHeuristicFinding, domEvidenceFor } from './finding-builder.js';
import type { HeuristicOutcome } from './types.js';

const CHECK_ID = 'resp.reflow-320' as CheckId;
const SC: readonly KnownScId[] = ['1.4.10'];
/** 1.4.10 is defined at 320 CSS px. Only apply to a capture near that width. */
const MAX_APPLICABLE_WIDTH = 400;
/** Sub-pixel rounding and scrollbar gutters produce a px or two of slack. */
const TOLERANCE = 2;

const ROOT_TAGS = new Set(['html', 'body']);

/** True when `outer` is an ancestor of `inner` by xpath containment. */
function contains(outer: ElementRecord, inner: ElementRecord): boolean {
  return inner.xpath.startsWith(`${outer.xpath}/`);
}

/**
 * `resp.reflow-320` — WCAG 1.4.10.
 *
 * The ground truth for "this page scrolls horizontally" is
 * `scrollWidth > clientWidth`, captured once in `capture.layout`. When it does,
 * the culprits are the elements that are themselves wider than the viewport — a
 * fixed-width container or table that refuses to reflow. Reporting the outermost
 * such elements (not every nested descendant) points at the actual cause.
 *
 * Pure over the capture, so it runs on every platform; the browser only has to
 * have captured at the 320px viewport.
 */
export function analyzeReflow(capture: StateCapture): HeuristicOutcome {
  // Only meaningful at the narrow viewport 1.4.10 is defined for. A desktop
  // capture legitimately has wide content, so applying it there would be noise.
  if (capture.viewport.width > MAX_APPLICABLE_WIDTH) {
    return { checkId: CHECK_ID, sc: SC, findings: [], candidatesChecked: 0 };
  }

  const { scrollWidth, clientWidth } = capture.layout;
  const scrollsHorizontally = scrollWidth - clientWidth > TOLERANCE;

  if (!scrollsHorizontally) {
    // Checked, and the page reflows cleanly — positive evidence for scoring.
    return { checkId: CHECK_ID, sc: SC, findings: [], candidatesChecked: 1 };
  }

  const tooWide = capture.elements.filter(
    (el) => el.visible && !ROOT_TAGS.has(el.tag) && el.bbox !== null && el.bbox.width > clientWidth + TOLERANCE,
  );

  // Keep only the outermost overflowing elements: a wide table's cells are wide
  // too, but the table is the cause, not each cell.
  const culprits = tooWide.filter((el) => !tooWide.some((other) => other !== el && contains(other, el)));

  const findings = culprits.map((el) => {
    const width = Math.round(el.bbox?.width ?? 0);
    const evidence: Evidence[] = [
      {
        kind: 'tool',
        tool: 'playwright',
        output:
          `At a ${String(capture.viewport.width)} CSS-pixel viewport this element is ${String(width)}px wide, ` +
          `forcing horizontal scrolling: document scrollWidth ${String(scrollWidth)} exceeds clientWidth ${String(clientWidth)}.`,
      },
      domEvidenceFor(el),
    ];
    return buildHeuristicFinding(
      {
        checkId: CHECK_ID,
        element: el,
        sc: SC,
        tier: 'violation',
        severity: 'serious',
        description:
          `Content does not reflow to a ${String(capture.viewport.width)}px viewport: this ${el.tag} is ` +
          `${String(width)}px wide and forces two-dimensional scrolling.`,
        evidence,
      },
      capture,
    );
  });

  return { checkId: CHECK_ID, sc: SC, findings, candidatesChecked: 1 };
}
