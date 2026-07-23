import type { CheckId, Evidence } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../../capture/types.js';
import { buildHeuristicFinding, domEvidenceFor } from './finding-builder.js';
import type { KeyboardTraversal } from './keyboard-traversal.js';
import type { FocusStyle } from './read-active-element.browser.js';
import type { HeuristicOutcome } from './types.js';

const CHECK_ID = 'kbd.focus-visible' as CheckId;
const SC: readonly KnownScId[] = ['2.4.7'];

function hasOutline(style: FocusStyle): boolean {
  return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
}

/**
 * Whether focusing the element changed anything a sighted user could see.
 *
 * A real outline is the common indicator, but a design might instead swap the
 * box-shadow, border or background. The check is a *delta*: an outline that was
 * already there does not count — only a visible change on focus does.
 */
function hasVisibleIndicator(focused: FocusStyle, unfocused: ElementRecord['style']): boolean {
  if (hasOutline(focused)) return true;
  return (
    focused.boxShadow !== unfocused.boxShadow ||
    focused.borderColor !== unfocused.borderColor ||
    focused.borderWidth !== unfocused.borderWidth ||
    focused.backgroundColor !== unfocused.backgroundColor
  );
}

function label(element: ElementRecord): string {
  return element.accessibleName ?? element.text ?? element.selector;
}

/**
 * `kbd.focus-visible` — WCAG 2.4.7 Focus Visible.
 *
 * For every element the keyboard traversal reached, compares its focused
 * computed style against its unfocused style from the index. No visible change
 * means no focus indicator — the failure a blanket `outline: none` introduces.
 * Because the traversal used real Tab presses, `:focus-visible` styles are in
 * force, so a control that restores its ring under `:focus-visible` correctly
 * passes.
 *
 * The plan's "style-delta then pixel-diff" ladder starts here at the cheap
 * style-delta rung; a later pass can add pixel diffing for the genuinely
 * ambiguous cases. Pure over the traversal.
 */
export function analyzeFocusVisible(
  capture: StateCapture,
  traversal: KeyboardTraversal,
): HeuristicOutcome {
  const byXpath = new Map(capture.elements.map((el) => [el.xpath, el]));
  const findings = [];
  let checked = 0;

  for (const stop of traversal.stops) {
    const element = byXpath.get(stop.xpath);
    if (element === undefined) continue;
    checked += 1;

    if (hasVisibleIndicator(stop.focusStyle, element.style)) continue;

    const evidence: Evidence[] = [
      {
        kind: 'pixels',
        metric: 'focus-indicator-delta',
        // No measurable change between the unfocused and focused states.
        measured: 0,
        threshold: 1,
        comparator: 'gte',
      },
      {
        kind: 'tool',
        tool: 'playwright',
        output:
          `Focusing "${label(element)}" produced no visible indicator: outline ${stop.focusStyle.outlineStyle}/` +
          `${stop.focusStyle.outlineWidth}, and box-shadow, border and background were unchanged from the unfocused state.`,
      },
      domEvidenceFor(element),
    ];

    findings.push(
      buildHeuristicFinding(
        {
          checkId: CHECK_ID,
          element,
          sc: SC,
          tier: 'violation',
          severity: 'serious',
          description:
            `"${label(element)}" shows no visible focus indicator when reached by keyboard — ` +
            `a sighted keyboard user cannot tell where focus is.`,
          evidence,
        },
        capture,
      ),
    );
  }

  return { checkId: CHECK_ID, sc: SC, findings, candidatesChecked: checked };
}
