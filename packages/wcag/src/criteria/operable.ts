import { define } from '../define.js';
import { ALWAYS_APPLICABLE, requiresSignal, type SuccessCriterion } from '../types.js';

/** Principle 2 — Operable. 20 criteria at A/AA. */
export const OPERABLE = [
  define({
    num: '2.1.1',
    title: 'Keyboard',
    level: 'A',
    principle: 'operable',
    guideline: '2.1 Keyboard Accessible',
    since: '2.0',
    understanding:
      'All functionality is available from a keyboard, without requiring specific timings for individual keystrokes.',
    userImpact:
      'Screen-reader users, people with motor impairments, and anyone using a switch device or voice control drive the page through the keyboard interface. Functionality that needs a mouse simply does not exist for them.',
    commonFailures: [
      'div or span used as a button with only a click handler',
      'Custom widgets — sliders, drag-and-drop, carousels — with no key bindings',
      'Menus that open on hover only',
      'Canvas or SVG interactions with no keyboard equivalent',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'kbd.walk', class: 'detects-failures' },
      { checkId: 'axe.scrollable-region-focusable', class: 'detects-failures' },
      { checkId: 'axe.frame-focusable-content', class: 'detects-failures' },
    ],
    manualProcedure:
      'Unplug the mouse and complete every task on the page. Anything you cannot reach or activate fails.',
    en301549: '9.2.1.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.1.2',
    title: 'No Keyboard Trap',
    level: 'A',
    principle: 'operable',
    guideline: '2.1 Keyboard Accessible',
    since: '2.0',
    understanding:
      'Keyboard focus can always be moved away from a component using only the keyboard, and if that needs more than the standard arrow, tab and escape keys, the user is told how.',
    userImpact:
      'The worst failure mode in the whole specification. A trapped keyboard user cannot leave, cannot reach the rest of the page, and cannot recover except by reloading and losing their place.',
    commonFailures: [
      'Modal dialogs that cycle focus with no Escape handler and no reachable close control',
      'Embedded players or plugins that capture focus and never release it',
      'Custom widgets that intercept Tab without providing an exit',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'kbd.focus-trap', class: 'decides' }],
    manualProcedure:
      'Tab through the entire page, including every dialog and embedded component, and confirm you can always get back out.',
    en301549: '9.2.1.2',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.1.4',
    title: 'Character Key Shortcuts',
    level: 'A',
    principle: 'operable',
    guideline: '2.1 Keyboard Accessible',
    since: '2.1',
    understanding:
      'Single-character keyboard shortcuts can be turned off, remapped, or are active only when the relevant component has focus.',
    userImpact:
      'Speech-input users trigger single-key shortcuts constantly just by talking. So does anyone with a tremor. A page-wide "d" shortcut can delete something mid-sentence.',
    commonFailures: [
      'Single-letter shortcuts bound at document level with no way to disable them',
      'Shortcuts documented but not remappable',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'kbd.single-key-shortcut', class: 'detects-failures' }],
    manualProcedure:
      'Identify every single-character shortcut and confirm it can be disabled or remapped, or that it only fires when its component has focus.',
    en301549: '9.2.1.4',
    section508: false,
    applicability: requiresSignal('hasKeyboardShortcuts'),
  }),

  define({
    num: '2.2.1',
    title: 'Timing Adjustable',
    level: 'A',
    principle: 'operable',
    guideline: '2.2 Enough Time',
    since: '2.0',
    understanding:
      'Time limits can be turned off, adjusted to at least ten times the default, or extended by the user after a warning with at least twenty seconds to respond.',
    userImpact:
      'Reading with a screen reader, typing with a switch, or thinking through a form with a cognitive disability all take longer. A session that expires mid-task discards the work.',
    commonFailures: [
      'Session timeouts with no warning and no extension',
      'Carousels that advance on a timer with no pause',
      'Checkout or booking flows with a countdown that cannot be extended',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'time.limit-adjustable', class: 'surfaces-candidates' }],
    manualProcedure:
      'Find every time limit. Confirm each can be disabled, extended, or adjusted — and that the warning gives at least twenty seconds.',
    en301549: '9.2.2.1',
    section508: true,
    applicability: requiresSignal('hasTimeLimits'),
  }),

  define({
    num: '2.2.2',
    title: 'Pause, Stop, Hide',
    level: 'A',
    principle: 'operable',
    guideline: '2.2 Enough Time',
    since: '2.0',
    understanding:
      'Content that moves, blinks or scrolls automatically for more than five seconds can be paused, stopped or hidden — as can auto-updating content.',
    userImpact:
      'Motion beside text makes reading impossible for many users with attention or vestibular conditions, and auto-updating regions can move a target out from under a pointer mid-click.',
    commonFailures: [
      'Auto-advancing carousels with no pause control',
      'Animated banners or marquees that loop indefinitely',
      'Live-updating feeds with no way to stop them',
      'Background video that cannot be paused',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'motion.auto-moving', class: 'decides' }],
    manualProcedure:
      'Watch the page for ten seconds without interacting. Anything still moving needs a reachable pause, stop or hide control.',
    en301549: '9.2.2.2',
    section508: true,
    applicability: requiresSignal('hasMovingContent'),
  }),

  define({
    num: '2.3.1',
    title: 'Three Flashes or Below Threshold',
    level: 'A',
    principle: 'operable',
    guideline: '2.3 Seizures and Physical Reactions',
    since: '2.0',
    understanding:
      'Nothing flashes more than three times per second, unless the flash is below the general and red flash thresholds.',
    userImpact:
      'The only criterion whose failure can cause immediate physical harm. Flashing content can trigger a seizure in someone with photosensitive epilepsy, without warning and without them having chosen to look.',
    commonFailures: [
      'Strobing effects in video or animated adverts',
      'Rapid flashing transitions or attention-grabbing banners',
      'Auto-playing GIFs with high-frequency flashing',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Analyse video and animation with a photosensitivity tool such as PEAT. Do not eyeball this one — the thresholds are quantitative and the cost of being wrong is a seizure.',
    en301549: '9.2.3.1',
    section508: true,
    applicability: requiresSignal('hasFlashingContent'),
  }),

  define({
    num: '2.4.1',
    title: 'Bypass Blocks',
    level: 'A',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding:
      'A mechanism exists to skip over blocks of content repeated across pages — usually a skip link, or landmark regions with real headings.',
    userImpact:
      'Without it, a keyboard user tabs through the entire navigation on every single page before reaching the content. Fifty links, every page.',
    commonFailures: [
      'No skip link and no landmark regions',
      'A skip link that is hidden from keyboard focus as well as sight',
      'A skip link whose target is not focusable, so focus never actually moves',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'kbd.skip-link', class: 'detects-failures' },
      { checkId: 'axe.bypass', class: 'detects-failures' },
    ],
    manualProcedure:
      'Press Tab once on a fresh page load. Confirm a skip mechanism appears, works, and actually moves focus to the main content.',
    en301549: '9.2.4.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.4.2',
    title: 'Page Titled',
    level: 'A',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding: 'Pages have titles that describe their topic or purpose.',
    userImpact:
      'The title is the first thing a screen reader announces and the label on every tab, bookmark and history entry. Twenty tabs all reading "Home" is a navigation failure.',
    commonFailures: [
      'Missing or empty title element',
      'The same title on every page of a single-page app',
      'Titles left as "Untitled" or the framework default',
      'Site name first, so the distinguishing part is cut off in a narrow tab',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.document-title', class: 'detects-failures' },
      { checkId: 'ai.page-title', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Read the title of each page out of context and ask whether it identifies that page uniquely.',
    en301549: '9.2.4.2',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.4.3',
    title: 'Focus Order',
    level: 'A',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding:
      'When the order in which components receive focus affects meaning or operability, focus moves in an order that preserves meaning and operability.',
    userImpact:
      'A tab order that jumps around the page is disorienting for sighted keyboard users and incoherent for screen-reader users, who lose the relationship between a control and the content it belongs to.',
    commonFailures: [
      'Positive tabindex values overriding natural order',
      'Modals that do not move focus into themselves on open',
      'Focus not returned to the trigger when a dialog closes',
      'DOM order not matching visual order after CSS reordering',
    ],
    testability: 'machine-decidable',
    // axe has no WCAG-tagged rule for focus order — its `tabindex` rule is
    // best-practice only — so walking the real tab order is the whole coverage.
    detectionCoverage: [{ checkId: 'kbd.walk', class: 'decides' }],
    manualProcedure:
      'Tab through the page and watch the focus indicator. It should move in the order a reader would expect, and dialogs should trap and restore focus deliberately.',
    en301549: '9.2.4.3',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.4.4',
    title: 'Link Purpose (In Context)',
    level: 'A',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding:
      'The purpose of each link can be determined from its text alone, or from the text together with its programmatically determined context.',
    userImpact:
      'Screen-reader users routinely pull up a list of every link on the page to navigate. In that list the surrounding sentence is gone — twelve entries reading "Read more" are twelve identical, useless choices.',
    commonFailures: [
      '"Click here", "Read more", "Learn more" repeated across a page',
      'Bare URLs as link text',
      'Icon-only links with no accessible name',
      'Adjacent image and text links to the same place, announced twice',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.link-name', class: 'detects-failures' },
      { checkId: 'ai.link-purpose', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'List every link on the page with its accessible name and read the list on its own. Any entry whose destination you cannot guess fails.',
    en301549: '9.2.4.4',
    section508: true,
    applicability: requiresSignal('hasLinks'),
  }),

  define({
    num: '2.4.5',
    title: 'Multiple Ways',
    level: 'AA',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding:
      'More than one way is available to locate a page within a set of pages, unless the page is a step in a process.',
    userImpact:
      'People navigate differently. Someone who finds hierarchical menus hard to hold in mind may rely entirely on search; someone using a screen reader may prefer a sitemap. Offering only one route excludes whoever it does not suit.',
    commonFailures: [
      'Navigation menu as the only route, with no search and no sitemap',
      'A search box that does not actually index the site',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'site.multiple-ways', class: 'detects-failures' }],
    manualProcedure:
      'Confirm at least two of: site search, sitemap, navigation menu, or a table of contents — and that each genuinely reaches the pages.',
    en301549: '9.2.4.5',
    section508: true,
    applicability: (s) => (s.pagesInScan > 1 ? 'applicable' : 'unknown'),
  }),

  define({
    num: '2.4.6',
    title: 'Headings and Labels',
    level: 'AA',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding: 'Headings and labels describe their topic or purpose.',
    userImpact:
      'Headings are the primary navigation structure for screen-reader users. A heading that does not describe its section, or a label that does not describe its field, makes that structure misleading rather than merely absent.',
    commonFailures: [
      'Generic headings — "Information", "Details", "More"',
      'Labels that repeat the placeholder rather than naming the field',
      'Several sections under identical headings',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.empty-heading', class: 'detects-failures', attribution: 'handrail' },
      { checkId: 'ai.heading-quality', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Read the headings alone as an outline of the page, and each label alone as a description of its field. Both should make sense without the surrounding content.',
    en301549: '9.2.4.6',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.4.7',
    title: 'Focus Visible',
    level: 'AA',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.0',
    understanding:
      'Any keyboard-operable interface has a mode of operation where the keyboard focus indicator is visible.',
    userImpact:
      'A sighted keyboard user who cannot see where focus is has to press keys and guess. This is the single most common real-world failure, usually introduced by a blanket `outline: none` in a reset stylesheet.',
    commonFailures: [
      'outline: none with no replacement indicator',
      'A focus style with too little contrast to notice',
      'Indicators visible on some components but not custom ones',
      'Focus styles removed because a designer disliked the default ring',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'kbd.focus-visible', class: 'decides' }],
    manualProcedure:
      'Tab through every interactive element and confirm you can always see where focus is, on every background it appears against.',
    en301549: '9.2.4.7',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.4.11',
    title: 'Focus Not Obscured (Minimum)',
    level: 'AA',
    principle: 'operable',
    guideline: '2.4 Navigable',
    since: '2.2',
    understanding:
      'When a component receives keyboard focus, it is not entirely hidden by author-created content.',
    userImpact:
      'Sticky headers, cookie banners and floating chat widgets routinely cover the element that just received focus. The user is operating a control they cannot see.',
    commonFailures: [
      'Sticky headers covering focused elements when scrolled into view',
      'Cookie consent bars sitting over the bottom of the page',
      'Floating chat widgets obscuring form controls',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'kbd.focus-obscured', class: 'decides' }],
    manualProcedure:
      'Tab through the page at several scroll positions with any sticky or floating content present, and confirm the focused element is never fully hidden.',
    en301549: null,
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.5.1',
    title: 'Pointer Gestures',
    level: 'A',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.1',
    understanding:
      'Functionality using multipoint or path-based gestures has a single-pointer alternative, unless the gesture is essential.',
    userImpact:
      'Pinch, swipe and multi-finger gestures are impossible with a head pointer, a switch, or a hand with limited dexterity. Without an alternative the functionality is simply unavailable.',
    commonFailures: [
      'Carousels advanced only by swiping',
      'Maps that zoom only by pinching',
      'Sliders draggable only along a path',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ptr.gesture-alternative', class: 'surfaces-candidates' }],
    manualProcedure:
      'For each gesture-driven feature, confirm a single tap or click alternative exists and is discoverable.',
    en301549: '9.2.5.1',
    section508: false,
    applicability: requiresSignal('hasPointerGestures'),
  }),

  define({
    num: '2.5.2',
    title: 'Pointer Cancellation',
    level: 'A',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.1',
    understanding:
      'For single-pointer functionality, the action completes on the up event, or can be aborted or undone.',
    userImpact:
      'Users with tremors or imprecise pointing frequently press down in the wrong place. Firing on down-event removes the chance to slide off and cancel — a mistake becomes an irreversible action.',
    commonFailures: [
      'Handlers bound to mousedown or touchstart for destructive actions',
      'Drag interactions that commit as soon as the pointer goes down',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ptr.down-event', class: 'detects-failures' }],
    manualProcedure:
      'Press down on a control, move away, and release. Nothing should have happened.',
    en301549: '9.2.5.2',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.5.3',
    title: 'Label in Name',
    level: 'A',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.1',
    understanding:
      'For components with a visible text label, the accessible name contains that visible text.',
    userImpact:
      'Speech-input users say what they see: "click Submit". If the accessible name is "Send form", the command fails and there is nothing on screen to tell them why.',
    commonFailures: [
      'aria-label replacing rather than extending the visible text',
      'Visible "Search" with an accessible name of "Find"',
      'Icon plus text where aria-label describes only the icon',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [
      { checkId: 'axe.label-content-name-mismatch', class: 'detects-failures' },
    ],
    manualProcedure:
      'For each labelled control, confirm the accessible name starts with or contains the visible text, in the same order.',
    en301549: '9.2.5.3',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '2.5.4',
    title: 'Motion Actuation',
    level: 'A',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.1',
    understanding:
      'Functionality triggered by device or user motion can also be operated through interface components, and motion actuation can be disabled.',
    userImpact:
      'Someone whose device is mounted to a chair cannot shake it. Someone with a tremor may trigger it constantly by accident. Both need the same feature reachable another way.',
    commonFailures: [
      'Shake-to-undo with no undo button',
      'Tilt-controlled interactions with no alternative',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ptr.motion-actuation', class: 'surfaces-candidates' }],
    manualProcedure:
      'Identify motion-triggered features and confirm each has a conventional control and can be turned off.',
    en301549: '9.2.5.4',
    section508: false,
    applicability: requiresSignal('hasMotionActuation'),
  }),

  define({
    num: '2.5.7',
    title: 'Dragging Movements',
    level: 'AA',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.2',
    understanding:
      'Functionality that uses a dragging movement can also be achieved with a single pointer without dragging, unless dragging is essential.',
    userImpact:
      'Sustained dragging is hard or impossible with a tremor, a head pointer, or a switch. Reordering a list or setting a slider should not require holding a button down along a path.',
    commonFailures: [
      'Drag-and-drop reordering with no move-up/move-down alternative',
      'Sliders adjustable only by dragging the thumb',
      'Kanban boards where cards can only be dragged between columns',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ptr.dragging-alternative', class: 'surfaces-candidates' }],
    manualProcedure:
      'For each draggable interaction, confirm the same result can be achieved with discrete clicks or taps.',
    en301549: null,
    section508: false,
    applicability: requiresSignal('hasDragInteractions'),
  }),

  define({
    num: '2.5.8',
    title: 'Target Size (Minimum)',
    level: 'AA',
    principle: 'operable',
    guideline: '2.5 Input Modalities',
    since: '2.2',
    understanding:
      'Pointer targets are at least 24 by 24 CSS pixels, with exceptions for spacing, inline targets, targets whose size is determined by the user agent, and cases where the presentation is essential.',
    userImpact:
      'Small targets are hard to hit with a tremor, a large fingertip, or a head pointer — and a mis-hit on a dense toolbar can trigger the wrong action rather than none.',
    commonFailures: [
      'Icon buttons drawn at 16 or 20 pixels square',
      'Close buttons on toasts and modals sized to the glyph',
      'Dense toolbars with no spacing between adjacent targets',
      'Pagination controls sized to the digit',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'ptr.target-size', class: 'decides' }],
    manualProcedure:
      'Measure targets that look small. Apply the exception ladder properly — inline links in a sentence are exempt, and adequate spacing can compensate — because a check that ignores the exceptions produces more noise than signal.',
    en301549: null,
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),
] satisfies readonly SuccessCriterion[];
