import { define } from '../define.js';
import { ALWAYS_APPLICABLE, requiresSignal, type SuccessCriterion } from '../types.js';

/** Principle 3 — Understandable. 13 criteria at A/AA. */
export const UNDERSTANDABLE = [
  define({
    num: '3.1.1',
    title: 'Language of Page',
    level: 'A',
    principle: 'understandable',
    guideline: '3.1 Readable',
    since: '2.0',
    understanding: 'The default human language of each page is programmatically determined.',
    userImpact:
      'A screen reader picks its pronunciation rules from this attribute. Get it wrong and English is read with French phonetics — technically speech, practically noise. It is also the cheapest fix in the entire specification.',
    commonFailures: [
      'No lang attribute on the html element',
      'lang="en" on a page written in another language',
      'A region subtag that contradicts the content',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [
      { checkId: 'axe.html-has-lang', class: 'decides' },
      { checkId: 'ai.lang-matches-content', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Confirm the html element declares a valid language tag and that it matches the language actually used.',
    en301549: '9.3.1.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '3.1.2',
    title: 'Language of Parts',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.1 Readable',
    since: '2.0',
    understanding:
      'Passages in a different language from the page default are marked with their own language, except for proper names, technical terms, and words that have entered the surrounding language.',
    userImpact:
      'Without it a screen reader reads a French quotation with English pronunciation, which is often unintelligible rather than merely accented.',
    commonFailures: [
      'Untagged quotations or passages in another language',
      'Multilingual navigation where each language option is announced in the page language',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ai.lang-of-parts', class: 'surfaces-candidates' }],
    manualProcedure:
      'Find passages in another language and confirm each carries a lang attribute, excluding proper nouns and naturalised terms.',
    en301549: '9.3.1.2',
    section508: true,
    applicability: requiresSignal('hasForeignLanguagePassages'),
  }),

  define({
    num: '3.2.1',
    title: 'On Focus',
    level: 'A',
    principle: 'understandable',
    guideline: '3.2 Predictable',
    since: '2.0',
    understanding: 'Receiving focus does not itself trigger a change of context.',
    userImpact:
      'A keyboard user tabs to explore. If focusing a control navigates away or opens a dialog, exploration becomes hazardous and the page cannot be surveyed before acting.',
    commonFailures: [
      'Select elements that submit or navigate on focus',
      'Focus handlers that open modals or move focus elsewhere',
      'Auto-advancing between fields as focus arrives',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'kbd.focus-context-change', class: 'detects-failures' }],
    manualProcedure:
      'Tab through every control without activating anything. Nothing should navigate, submit, or open.',
    en301549: '9.3.2.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '3.2.2',
    title: 'On Input',
    level: 'A',
    principle: 'understandable',
    guideline: '3.2 Predictable',
    since: '2.0',
    understanding:
      'Changing the setting of a control does not automatically cause a change of context unless the user was warned beforehand.',
    userImpact:
      'A screen-reader user moving through a select with arrow keys triggers every intermediate option. If each one navigates, they never reach the one they wanted.',
    commonFailures: [
      'Country or language selects that navigate on change with no Go button',
      'Forms that submit as soon as the last field is filled',
      'Radio buttons that immediately load new content',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'form.input-context-change', class: 'detects-failures' }],
    manualProcedure:
      'Change each control with the keyboard. Confirm nothing navigates or submits without an explicit action, or that a warning precedes it.',
    en301549: '9.3.2.2',
    section508: true,
    applicability: requiresSignal('hasForms'),
  }),

  define({
    num: '3.2.3',
    title: 'Consistent Navigation',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.2 Predictable',
    since: '2.0',
    understanding:
      'Navigation repeated across pages appears in the same relative order each time, unless the user changed it.',
    userImpact:
      'Users who navigate by memory — screen-reader users counting tab stops, users with cognitive disabilities relying on a learned position — are thrown by navigation that reshuffles between pages.',
    commonFailures: [
      'Menu items in a different order on different templates',
      'Search or account links moving between header and footer across sections',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'site.consistent-nav', class: 'decides' }],
    manualProcedure:
      'Compare the navigation across several page templates and confirm the relative order is stable.',
    en301549: '9.3.2.3',
    section508: true,
    applicability: (s) => (s.pagesInScan > 1 ? 'applicable' : 'not-applicable'),
  }),

  define({
    num: '3.2.4',
    title: 'Consistent Identification',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.2 Predictable',
    since: '2.0',
    understanding:
      'Components with the same functionality within a set of pages are identified consistently.',
    userImpact:
      'When the same action is labelled "Search" on one page and "Find" on the next, users who rely on labels rather than on visual layout have to re-learn the interface each time.',
    commonFailures: [
      'The same icon meaning different things in different places',
      'Search inputs labelled differently across templates',
      'Download links whose accessible names vary for identical functionality',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'site.consistent-identification', class: 'decides' }],
    manualProcedure:
      'Collect the accessible names of functionally identical components across pages and confirm they match.',
    en301549: '9.3.2.4',
    section508: true,
    applicability: (s) => (s.pagesInScan > 1 ? 'applicable' : 'not-applicable'),
  }),

  define({
    num: '3.2.6',
    title: 'Consistent Help',
    level: 'A',
    principle: 'understandable',
    guideline: '3.2 Predictable',
    since: '2.2',
    understanding:
      'Where help mechanisms are repeated across pages, they appear in the same relative order each time.',
    userImpact:
      'Someone who needs help is already struggling. Making them hunt for the contact link in a different place on every page compounds exactly the difficulty they were trying to resolve.',
    commonFailures: [
      'A contact link in the header on some pages and the footer on others',
      'A chat widget that appears on some templates and not others, in different positions',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'site.consistent-help', class: 'decides' }],
    manualProcedure:
      'Identify each help mechanism — contact details, chat, self-help — and confirm its position relative to other content is stable across pages.',
    en301549: null,
    section508: false,
    applicability: (s) =>
      s.pagesInScan > 1 && s.hasHelpMechanism ? 'applicable' : 'unknown',
  }),

  define({
    num: '3.3.1',
    title: 'Error Identification',
    level: 'A',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.0',
    understanding:
      'Input errors that are automatically detected are identified, and the error is described to the user in text.',
    userImpact:
      'An error indicated only by a red border tells a screen-reader user nothing, and tells a colour-blind user nothing. They know the form failed but not which field or why.',
    commonFailures: [
      'Red borders as the only error indication',
      'A generic "Please correct the errors below" with nothing per-field',
      'Errors rendered visually but never announced or associated with the field',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'form.error-identification', class: 'detects-failures' },
      { checkId: 'ai.error-messages', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Submit each form with deliberate errors and confirm each error is described in text and programmatically associated with its field.',
    en301549: '9.3.3.1',
    section508: true,
    applicability: requiresSignal('hasForms'),
  }),

  define({
    num: '3.3.2',
    title: 'Labels or Instructions',
    level: 'A',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.0',
    understanding: 'Labels or instructions are provided when content requires user input.',
    userImpact:
      'An unlabelled field is announced as "edit text" and nothing else. A placeholder is not a substitute — it disappears the moment typing starts, and it is not reliably exposed as a name.',
    commonFailures: [
      'Placeholder text used as the only label',
      'Labels associated by proximity rather than for/id',
      'Format requirements — date format, password rules — revealed only after a failed submit',
      'Required fields not identified as required',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.label', class: 'detects-failures', attribution: 'handrail' },
      { checkId: 'axe.form-field-multiple-labels', class: 'detects-failures' },
      { checkId: 'ai.label-quality', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Inspect each control\'s accessible name, and confirm format and requirement information is available before submission rather than after.',
    en301549: '9.3.3.2',
    section508: true,
    applicability: requiresSignal('hasForms'),
  }),

  define({
    num: '3.3.3',
    title: 'Error Suggestion',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.0',
    understanding:
      'When an input error is detected and a correction is known, the suggestion is offered to the user — unless doing so would compromise security or purpose.',
    userImpact:
      '"Invalid input" leaves the user guessing. Telling them the expected format, or that the date must be in the future, turns a dead end into a next step — which matters most for users with cognitive disabilities.',
    commonFailures: [
      '"Invalid entry" with no indication of what would be valid',
      'Date validation that rejects without stating the expected format',
      'Password rules revealed only one failure at a time',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ai.error-suggestion', class: 'surfaces-candidates' }],
    manualProcedure:
      'Trigger each validation error and confirm the message says how to fix it, not merely that something is wrong.',
    en301549: '9.3.3.3',
    section508: true,
    applicability: requiresSignal('hasForms'),
  }),

  define({
    num: '3.3.4',
    title: 'Error Prevention (Legal, Financial, Data)',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.0',
    understanding:
      'For pages creating legal commitments or financial transactions, or modifying or deleting user data, submissions are reversible, checked, or confirmed.',
    userImpact:
      'Everyone makes mistakes, and users with cognitive or motor disabilities make more of them. Without a reversal, a check, or a confirmation, a slip becomes a purchase, a cancellation, or deleted data.',
    commonFailures: [
      'One-click purchase with no review step and no cancellation window',
      'Account deletion with no confirmation',
      'Bookings that commit immediately with no chance to review',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Identify every consequential action and confirm at least one of: it is reversible, the data is checked and errors are offered for correction, or a review-and-confirm step precedes it.',
    en301549: '9.3.3.4',
    section508: true,
    applicability: requiresSignal('hasLegalOrFinancialCommitment'),
  }),

  define({
    num: '3.3.7',
    title: 'Redundant Entry',
    level: 'A',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.2',
    understanding:
      'Information the user already entered in the same process is auto-populated or available to select, unless re-entry is essential — as it is when confirming a password.',
    userImpact:
      'Re-typing an address at every step of a checkout is tedious for most people and a genuine barrier for someone using a switch device or working from short-term memory.',
    commonFailures: [
      'Multi-step checkouts asking for the same address at each step',
      'No "same as billing" option for a shipping address',
      'Wizards that discard earlier answers on going back',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'form.redundant-entry', class: 'surfaces-candidates' }],
    manualProcedure:
      'Walk through each multi-step process and note anything you are asked for twice. Confirm each repeat is auto-filled, selectable, or genuinely essential.',
    en301549: null,
    section508: false,
    applicability: requiresSignal('hasMultiStepProcess'),
  }),

  define({
    num: '3.3.8',
    title: 'Accessible Authentication (Minimum)',
    level: 'AA',
    principle: 'understandable',
    guideline: '3.3 Input Assistance',
    since: '2.2',
    understanding:
      'No authentication step relies on a cognitive function test — remembering a password, solving a puzzle, transcribing characters — unless an alternative exists, or a mechanism assists, or the test is recognising objects or user-provided content.',
    userImpact:
      'Traditional CAPTCHAs and memory-based authentication exclude users with cognitive disabilities, dyslexia, and many older users. Blocking password managers by disabling paste turns a supported task into an unsupported one.',
    commonFailures: [
      'Blocking paste into password fields, defeating password managers',
      'Transcription CAPTCHAs with no non-cognitive alternative',
      'Requiring memorised security questions with no other route',
      'One-time codes that cannot be pasted',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'form.paste-blocked', class: 'detects-failures' }],
    manualProcedure:
      'Attempt to authenticate using a password manager. Confirm paste works, autofill works, and any puzzle step has an alternative.',
    en301549: null,
    section508: false,
    applicability: requiresSignal('hasAuthentication'),
  }),
] satisfies readonly SuccessCriterion[];
