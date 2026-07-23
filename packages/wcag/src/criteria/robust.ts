import { define } from '../define.js';
import { ALWAYS_APPLICABLE, type SuccessCriterion } from '../types.js';

/**
 * Principle 4 — Robust. 2 criteria at A/AA.
 *
 * Only two, because **4.1.1 Parsing was removed in WCAG 2.2**. It required
 * well-formed markup — unique ids, properly nested elements — at a time when
 * that genuinely broke assistive technology. Browsers and AT now recover from
 * those errors, so the criterion tested something that no longer mapped to user
 * harm. A reference that still counts it reports 56 criteria and gets every
 * coverage percentage slightly wrong.
 */
export const ROBUST = [
  define({
    num: '4.1.2',
    title: 'Name, Role, Value',
    level: 'A',
    principle: 'robust',
    guideline: '4.1 Compatible',
    since: '2.0',
    understanding:
      'For every user interface component, the name and role are programmatically determinable; states, properties and values can be set programmatically; and changes to them are notified to assistive technology.',
    userImpact:
      'This is the contract between a page and assistive technology. A custom control without it is announced as "clickable" with no name, no role and no state — the user cannot tell what it is, what it does, or whether it is currently on.',
    commonFailures: [
      'div or span used as a button with no role and no accessible name',
      'Custom checkboxes and toggles with no aria-checked or aria-pressed',
      'Comboboxes missing aria-expanded',
      'Icon-only controls with no accessible name',
      'ARIA attributes that are invalid for the element\'s role',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.aria-valid-attr', class: 'detects-failures' },
      { checkId: 'axe.aria-valid-attr-value', class: 'detects-failures' },
      { checkId: 'axe.aria-required-attr', class: 'detects-failures' },
      { checkId: 'axe.button-name', class: 'detects-failures' },
      { checkId: 'axe.link-name', class: 'detects-failures' },
      { checkId: 'ai.custom-widget-semantics', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Inspect each custom component in the accessibility tree. Confirm it has the right role, a meaningful name, and that its state updates in the tree as you operate it.',
    en301549: '9.4.1.2',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '4.1.3',
    title: 'Status Messages',
    level: 'AA',
    principle: 'robust',
    guideline: '4.1 Compatible',
    since: '2.1',
    understanding:
      'Status messages can be programmatically determined through role or properties, so assistive technology announces them without the message receiving focus.',
    userImpact:
      'A sighted user sees "3 results found" or "Saved" appear. Without a live region a screen-reader user gets nothing at all — they act on a page whose state has silently changed underneath them.',
    commonFailures: [
      'Search result counts updating with no live region',
      'Form validation summaries injected without aria-live',
      'Toast notifications appearing and disappearing silently',
      'Loading and progress indicators that are purely visual',
      'aria-live added to a container after the message is already in it',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'aria.status-messages', class: 'surfaces-candidates' }],
    manualProcedure:
      'Trigger each status change with a screen reader running and confirm it is announced without focus moving. Check that live regions exist in the DOM before their content is inserted.',
    en301549: '9.4.1.3',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),
] satisfies readonly SuccessCriterion[];
