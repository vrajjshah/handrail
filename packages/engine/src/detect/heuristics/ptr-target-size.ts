import type { BoundingBox, CheckId, Evidence } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../../capture/types.js';
import { buildHeuristicFinding, domEvidenceFor } from './finding-builder.js';
import type { HeuristicOutcome } from './types.js';

const CHECK_ID = 'ptr.target-size' as CheckId;
const SC: readonly KnownScId[] = ['2.5.8'];
const MIN_SIZE = 24;
const RADIUS = MIN_SIZE / 2;

const INTERACTIVE_TAGS = new Set(['a', 'button', 'select', 'textarea', 'summary']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'combobox',
  'searchbox',
]);

/** Interactive, visible, laid-out elements — the things a pointer aims at. */
function isPointerTarget(el: ElementRecord): boolean {
  if (!el.visible || el.bbox === null) return false;
  if (el.attributes.disabled !== undefined) return false;
  if (el.tag === 'a') return el.attributes.href !== undefined;
  if (el.tag === 'input') return (el.attributes.type ?? 'text') !== 'hidden';
  if (INTERACTIVE_TAGS.has(el.tag)) return true;
  return el.role !== null && INTERACTIVE_ROLES.has(el.role);
}

function centerOf(box: BoundingBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Shortest distance from a point to a rectangle (0 when inside). */
function pointToRectDistance(point: { x: number; y: number }, rect: BoundingBox): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Whether the spacing exception rescues an undersized target.
 *
 * WCAG 2.5.8: an undersized target passes if a 24px-diameter circle centred on it
 * intersects neither another target's area nor another undersized target's
 * circle. This is the difference between an isolated small icon (fine) and a row
 * of crammed-together ones (a failure) — and getting it wrong is the fastest way
 * to flood a real site with false positives, which is why it is implemented
 * rather than approximated.
 */
function spacingExempts(
  target: ElementRecord,
  targetBox: BoundingBox,
  others: { el: ElementRecord; box: BoundingBox; undersized: boolean }[],
): boolean {
  const center = centerOf(targetBox);
  for (const other of others) {
    if (other.el === target) continue;
    // (a) our circle intersects the other target's actual area.
    if (pointToRectDistance(center, other.box) < RADIUS) return false;
    // (b) two undersized circles intersect when their centres are < 24px apart.
    if (other.undersized) {
      const otherCenter = centerOf(other.box);
      if (Math.hypot(center.x - otherCenter.x, center.y - otherCenter.y) < MIN_SIZE) return false;
    }
  }
  return true;
}

/**
 * `ptr.target-size` — WCAG 2.5.8, with the exception ladder.
 *
 * A target under 24×24 is a failure **only** when it is not inline text and the
 * spacing exception does not apply. The plan is explicit that the ladder matters
 * here: a size-only check is wrong both ways — it flags isolated small targets
 * that WCAG permits, and it misses the point that crowding is what makes small
 * targets a barrier.
 *
 * Pure over the element index: no browser needed, so it runs on every platform.
 */
export function analyzeTargetSize(capture: StateCapture): HeuristicOutcome {
  const targets = capture.elements
    .filter(isPointerTarget)
    .map((el) => {
      const box = el.bbox!;
      const size = Math.min(box.width, box.height);
      return { el, box, size, undersized: size < MIN_SIZE };
    });

  const findings = targets
    .filter((t) => t.undersized)
    // Inline targets (a link in a run of text) are exempt: their size is set by
    // the line, not the author, and WCAG carves them out.
    .filter((t) => t.el.style.display !== 'inline')
    .filter((t) => !spacingExempts(t.el, t.box, targets))
    .map((t) => {
      const size = Math.round(t.size);
      const evidence: Evidence[] = [
        {
          kind: 'pixels',
          metric: 'target-size-px',
          measured: size,
          threshold: MIN_SIZE,
          comparator: 'gte',
        },
        domEvidenceFor(t.el),
      ];
      return buildHeuristicFinding(
        {
          checkId: CHECK_ID,
          element: t.el,
          sc: SC,
          tier: 'violation',
          severity: 'moderate',
          description:
            `Pointer target is ${String(Math.round(t.box.width))}×${String(Math.round(t.box.height))} CSS pixels, ` +
            `under the 24×24 minimum, and is crowded against an adjacent target so the spacing exception does not apply.`,
          evidence,
        },
        capture,
      );
    });

  return { checkId: CHECK_ID, sc: SC, findings, candidatesChecked: targets.length };
}
