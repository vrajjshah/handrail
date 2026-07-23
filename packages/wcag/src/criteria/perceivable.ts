import { define } from '../define.js';
import { ALWAYS_APPLICABLE, requiresSignal, type SuccessCriterion } from '../types.js';

/** Principle 1 — Perceivable. 20 criteria at A/AA. */
export const PERCEIVABLE = [
  define({
    num: '1.1.1',
    title: 'Non-text Content',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.1 Text Alternatives',
    since: '2.0',
    understanding:
      'Every non-text element carries a text alternative that serves the same purpose. Decorative content is the exception: it must be explicitly hidden from assistive technology rather than described.',
    userImpact:
      'A screen-reader user meets an image with no alternative as "image" or, worse, as a filename. Where the image is a link or a button, the destination becomes unguessable and the page stops working rather than merely degrading.',
    commonFailures: [
      'No alt attribute at all on an informative image',
      'alt="" on an image that carries meaning, hiding it entirely',
      'Filename or "image123" as the alternative',
      'Alt text that describes a different image — usually a template left unedited',
      'Icon-only buttons with no accessible name',
      'CSS background images carrying information with no text equivalent',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.image-alt', class: 'detects-failures' },
      { checkId: 'axe.button-name', class: 'detects-failures' },
      { checkId: 'ai.alt-vs-image', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'For each informative image, read the alternative with the image hidden and ask whether it conveys the same information. Confirm decorative images are hidden (alt="" or aria-hidden) rather than described.',
    en301549: '9.1.1.1',
    section508: true,
    applicability: requiresSignal('hasImages'),
  }),

  define({
    num: '1.2.1',
    title: 'Audio-only and Video-only (Prerecorded)',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.2 Time-based Media',
    since: '2.0',
    understanding:
      'Prerecorded audio-only content needs a text transcript. Prerecorded video-only content needs a transcript or an audio description of the visual information.',
    userImpact:
      'Without a transcript, a Deaf user gets nothing at all from a podcast, and a blind user gets nothing from a silent explainer video. There is no partial access here — the content is either available in another form or it is not.',
    commonFailures: [
      'Podcast episodes published with only show notes, not a transcript',
      'Silent animated explainers with no described alternative',
      'Auto-generated transcripts published without correction',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Find every prerecorded audio-only and video-only item. Confirm an alternative exists, is linked near the media, and actually conveys the same information — including speaker identification for audio.',
    en301549: '9.1.2.1',
    section508: true,
    applicability: (s) =>
      s.hasPrerecordedAudio || s.hasPrerecordedVideo ? 'applicable' : 'unknown',
  }),

  define({
    num: '1.2.2',
    title: 'Captions (Prerecorded)',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.2 Time-based Media',
    since: '2.0',
    understanding:
      'Prerecorded video with audio carries synchronised captions covering dialogue and the non-speech sound that matters.',
    userImpact:
      'Deaf and hard-of-hearing users lose the audio channel entirely. Captions are also what make video usable in a noisy room or a quiet office, which is why this one has a constituency far larger than its legal framing suggests.',
    commonFailures: [
      'No captions on a video with dialogue',
      'Auto-captions accepted uncorrected, so names and technical terms are wrong',
      'Captions covering speech but omitting significant sound effects',
      'Open captions burned in at a size that fails at small viewports',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Play each video with sound off. Confirm captions exist, stay in sync, identify speakers, and cover non-speech audio that carries meaning.',
    en301549: '9.1.2.2',
    section508: true,
    applicability: requiresSignal('hasPrerecordedVideo'),
  }),

  define({
    num: '1.2.3',
    title: 'Audio Description or Media Alternative (Prerecorded)',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.2 Time-based Media',
    since: '2.0',
    understanding:
      'Prerecorded video needs either an audio description of the visual information or a full text alternative covering the whole presentation.',
    userImpact:
      'A blind user hears the dialogue but misses everything shown rather than said — the diagram on screen, the on-screen text, the demonstration the narrator refers to as "this".',
    commonFailures: [
      'Tutorial videos where steps are shown but never spoken',
      'On-screen text that is never read aloud',
      'A transcript of dialogue only, with no description of the visuals',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Play each video without looking at the screen. Note anything you cannot follow, then confirm an audio description or full text alternative covers it.',
    en301549: '9.1.2.3',
    section508: true,
    applicability: requiresSignal('hasPrerecordedVideo'),
  }),

  define({
    num: '1.2.4',
    title: 'Captions (Live)',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.2 Time-based Media',
    since: '2.0',
    understanding: 'Live audio in synchronised media carries real-time captions.',
    userImpact:
      'Live streams, webinars and broadcast events are wholly inaccessible to Deaf users without them, and unlike prerecorded content there is no chance to catch up afterwards.',
    commonFailures: [
      'Live webinars with no captioning service arranged',
      'Relying on automatic speech recognition in a noisy or multi-speaker setting',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'For each live media feature, confirm real-time captions are provided and check their accuracy during an actual broadcast.',
    en301549: '9.1.2.4',
    section508: true,
    applicability: requiresSignal('hasLiveMedia'),
  }),

  define({
    num: '1.2.5',
    title: 'Audio Description (Prerecorded)',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.2 Time-based Media',
    since: '2.0',
    understanding:
      'Prerecorded video carries an audio description. At AA the text-alternative escape hatch that 1.2.3 allows is gone — description is required.',
    userImpact:
      'Everything conveyed only visually stays out of reach for blind users. A transcript helps, but it is not equivalent to hearing the description in time with the video.',
    commonFailures: [
      'Meeting 1.2.3 with a transcript and assuming AA is also met',
      'No described track offered for video where visuals carry information',
    ],
    testability: 'human-only',
    detectionCoverage: [],
    manualProcedure:
      'Confirm an audio-described track exists and that it covers the visual information not present in the main audio.',
    en301549: '9.1.2.5',
    section508: true,
    applicability: requiresSignal('hasPrerecordedVideo'),
  }),

  define({
    num: '1.3.1',
    title: 'Info and Relationships',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.3 Adaptable',
    since: '2.0',
    understanding:
      'Structure conveyed visually — headings, lists, tables, labels, groupings — is also conveyed in markup, so assistive technology can expose the same relationships.',
    userImpact:
      'This is the criterion that decides whether a screen-reader user can navigate at all. Without real headings there is no heading list; without real table markup a data table becomes an undifferentiated stream of cells.',
    commonFailures: [
      'Bold or large text used as a visual heading with no heading element',
      'Layout tables, or data tables with no header cells',
      'Form fields associated with their labels only by proximity',
      'Lists built from line breaks and bullet characters',
      'Related radio buttons or checkboxes with no fieldset and legend',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'axe.label', class: 'detects-failures' },
      { checkId: 'axe.table-headers', class: 'detects-failures' },
      { checkId: 'axe.list-structure', class: 'detects-failures' },
      { checkId: 'ai.heading-outline', class: 'surfaces-candidates' },
      { checkId: 'ai.visual-structure', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Compare the visual structure against the accessibility tree. Every grouping, heading level and label relationship that is visually obvious should be present in the tree too.',
    en301549: '9.1.3.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.3.2',
    title: 'Meaningful Sequence',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.3 Adaptable',
    since: '2.0',
    understanding:
      'Where the order of content affects its meaning, that order is available programmatically — the DOM order matches the reading order.',
    userImpact:
      'Screen readers and reflowed layouts follow source order. When CSS reorders content visually, those users get a sequence that reads as nonsense: a caption before its figure, a total before the numbers it sums.',
    commonFailures: [
      'CSS order or grid placement reordering content away from source order',
      'Absolutely positioned content appearing in a different visual place',
      'Multi-column layouts built so reading order runs across columns',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ai.reading-order', class: 'surfaces-candidates' }],
    manualProcedure:
      'Disable CSS, or read the page in DOM order, and confirm the content still makes sense in that sequence.',
    en301549: '9.1.3.2',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.3.3',
    title: 'Sensory Characteristics',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.3 Adaptable',
    since: '2.0',
    understanding:
      'Instructions do not depend solely on shape, colour, size, visual location, orientation or sound.',
    userImpact:
      '"Click the round button on the right" is unusable to someone who cannot see the layout, and "the green one" is unusable to someone who cannot distinguish it. The instruction has to survive losing any single sense.',
    commonFailures: [
      '"Select the button on the left" with no accessible name to go with it',
      '"Fields marked in red are required"',
      '"Click the icon below" where several icons are below',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ai.sensory-instructions', class: 'surfaces-candidates' }],
    manualProcedure:
      'Read the instructions aloud without looking at the page. Anything you cannot follow depends on a sensory characteristic.',
    en301549: '9.1.3.3',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.3.4',
    title: 'Orientation',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.3 Adaptable',
    since: '2.1',
    understanding:
      'Content does not lock to a single display orientation unless a specific orientation is essential.',
    userImpact:
      'Someone whose device is fixed to a wheelchair mount, or who cannot rotate a tablet, is locked out entirely by a portrait-only page.',
    commonFailures: [
      'CSS or JS forcing portrait and blocking landscape',
      'An interstitial telling the user to rotate their device',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'resp.orientation-lock', class: 'detects-failures' }],
    manualProcedure:
      'Load the page in both orientations on a real device and confirm both are usable.',
    en301549: '9.1.3.4',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.3.5',
    title: 'Identify Input Purpose',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.3 Adaptable',
    since: '2.1',
    understanding:
      'Fields collecting information about the user carry a programmatic purpose — in practice, the right `autocomplete` token.',
    userImpact:
      'It lets a browser or assistive tool fill in a name, email or address automatically, and lets symbol-based interfaces show a recognisable icon. For users with motor or cognitive disabilities, not retyping an address is the difference between a form being usable and being abandoned.',
    commonFailures: [
      'No autocomplete attribute on name, email, address or phone fields',
      'Invented values like autocomplete="your-email"',
      'autocomplete="off" applied form-wide as a habit',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [
      { checkId: 'axe.autocomplete-valid', class: 'detects-failures' },
      { checkId: 'form.autocomplete', class: 'decides' },
    ],
    manualProcedure:
      'For each field collecting user information, confirm the autocomplete token is present and drawn from the WCAG input-purpose list.',
    en301549: '9.1.3.5',
    section508: false,
    applicability: requiresSignal('hasForms'),
  }),

  define({
    num: '1.4.1',
    title: 'Use of Color',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.0',
    understanding:
      'Colour is never the only way information is conveyed, an action indicated, or a response signalled.',
    userImpact:
      'Around one in twelve men has a colour vision deficiency. Remove colour perception and a red-only error message, or a link distinguished from body text by hue alone, carries no information at all.',
    commonFailures: [
      'Required fields marked only in red',
      'Links in body text distinguished only by colour, with no underline',
      'Chart series identified only by a colour key',
      'Status shown as a coloured dot with no label',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'link.color-only', class: 'detects-failures' },
      { checkId: 'ai.color-only', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'View the page in greyscale. Anything you can no longer tell apart or act on fails.',
    en301549: '9.1.4.1',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.2',
    title: 'Audio Control',
    level: 'A',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.0',
    understanding:
      'Audio that plays automatically for more than three seconds can be paused, stopped, or have its volume controlled independently of the system volume.',
    userImpact:
      'Autoplaying audio drowns out a screen reader, which is the user\'s only channel — and finding the control to stop it requires hearing the screen reader they can no longer hear.',
    commonFailures: [
      'Background music or video with sound starting on load',
      'A stop control that exists but is not the first thing in the tab order',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'media.autoplay-audio', class: 'decides' }],
    manualProcedure:
      'Load the page and listen. If anything plays for more than three seconds, confirm a control to stop it is reachable immediately by keyboard.',
    en301549: '9.1.4.2',
    section508: true,
    applicability: requiresSignal('hasAudioAutoplay'),
  }),

  define({
    num: '1.4.3',
    title: 'Contrast (Minimum)',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.0',
    understanding:
      'Text and images of text have a contrast ratio of at least 4.5:1 against their background, or 3:1 for large text (18pt, or 14pt bold).',
    userImpact:
      'The most-reported barrier there is. It affects users with low vision, ageing eyes, and anyone reading on a phone in daylight — a constituency far wider than the disability framing implies.',
    commonFailures: [
      'Light grey placeholder and helper text',
      'White text over a photograph or gradient where some regions fail',
      'Brand colours used for body text without checking the ratio',
      'Disabled-looking text that is actually interactive',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [
      { checkId: 'axe.color-contrast', class: 'detects-failures' },
      { checkId: 'ai.contrast-gradient', class: 'surfaces-candidates' },
    ],
    manualProcedure:
      'Measure text over images, gradients and video where the background varies — automation can only sample, so a human picks the worst case.',
    en301549: '9.1.4.3',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.4',
    title: 'Resize Text',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.0',
    understanding:
      'Text can be resized up to 200% without assistive technology and without loss of content or functionality.',
    userImpact:
      'Zooming is the first thing a low-vision user does. If the layout breaks, text is clipped, or controls move off-screen at 200%, the page is unusable at the size they need.',
    commonFailures: [
      'Fixed pixel heights on containers, clipping text as it grows',
      'user-scalable=no or maximum-scale in the viewport meta tag',
      'Text in absolutely positioned boxes that overlap when enlarged',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [
      { checkId: 'resp.zoom-200', class: 'detects-failures' },
      { checkId: 'axe.meta-viewport', class: 'detects-failures' },
    ],
    manualProcedure:
      'Zoom to 200% and read every page. Confirm nothing is clipped, overlapped, or pushed out of reach.',
    en301549: '9.1.4.4',
    section508: true,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.5',
    title: 'Images of Text',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.0',
    understanding:
      'Text is real text rather than a picture of text, unless the presentation is essential or the image is customisable.',
    userImpact:
      'Text baked into an image cannot be resized without blurring, restyled for readability, selected, searched, or translated. The alt text usually names the image rather than reproducing what it says.',
    commonFailures: [
      'Marketing headings and pull quotes exported as images',
      'Opening hours, prices or contact details rendered into a graphic',
      'Buttons built as images with the label in the artwork',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ai.images-of-text', class: 'surfaces-candidates' }],
    manualProcedure:
      'Look for text that cannot be selected. For each case, decide whether the presentation is genuinely essential — a logo is, a price list is not.',
    en301549: '9.1.4.5',
    section508: true,
    applicability: requiresSignal('hasImages'),
  }),

  define({
    num: '1.4.10',
    title: 'Reflow',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.1',
    understanding:
      'Content reflows into a single column at 320 CSS pixels wide without requiring scrolling in two dimensions — except for content that genuinely needs it, like a data table or a map.',
    userImpact:
      'At 400% zoom on a desktop, the viewport is effectively 320px. Two-dimensional scrolling means reading every line by dragging back and forth, which is exhausting rather than merely inconvenient.',
    commonFailures: [
      'Fixed-width containers or tables wider than the viewport',
      'min-width on a layout wrapper',
      'Horizontally scrolling card rows containing primary content',
      'white-space: nowrap on long strings',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'resp.reflow-320', class: 'decides' }],
    manualProcedure:
      'At a 320px viewport, confirm no horizontal scrolling is needed, and that anything that does scroll horizontally is genuinely exempt.',
    en301549: '9.1.4.10',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.11',
    title: 'Non-text Contrast',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.1',
    understanding:
      'User interface components and meaningful graphics have at least 3:1 contrast against adjacent colours.',
    userImpact:
      'A low-vision user who cannot see a field border does not know where to click. Faint focus rings, invisible toggle states and low-contrast chart lines all fail here.',
    commonFailures: [
      'Input borders in a pale grey against white',
      'Focus indicators that meet a design aesthetic but not 3:1',
      'Toggle switches whose on and off states differ only subtly',
      'Icons carrying meaning drawn in a light tint',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ui.non-text-contrast', class: 'detects-failures' }],
    manualProcedure:
      'Measure the boundary of each control against its surroundings, and each state indicator against the state it replaces.',
    en301549: '9.1.4.11',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.12',
    title: 'Text Spacing',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.1',
    understanding:
      'No loss of content or functionality when the user overrides line height to 1.5×, paragraph spacing to 2×, letter spacing to 0.12em and word spacing to 0.16em.',
    userImpact:
      'Readers with dyslexia and some low-vision users apply spacing overrides to read at all. If the layout clips or overlaps under them, the accommodation is unavailable.',
    commonFailures: [
      'Fixed-height containers around text',
      'overflow: hidden clipping the enlarged block',
      '!important line-height blocking user stylesheets',
    ],
    testability: 'machine-decidable',
    detectionCoverage: [{ checkId: 'resp.text-spacing', class: 'detects-failures' }],
    manualProcedure:
      'Apply the four spacing overrides via a user stylesheet and confirm nothing is clipped or overlapped.',
    en301549: '9.1.4.12',
    section508: false,
    applicability: ALWAYS_APPLICABLE,
  }),

  define({
    num: '1.4.13',
    title: 'Content on Hover or Focus',
    level: 'AA',
    principle: 'perceivable',
    guideline: '1.4 Distinguishable',
    since: '2.1',
    understanding:
      'Content that appears on hover or focus can be dismissed without moving the pointer, stays visible while the pointer is over it, and remains until dismissed or no longer relevant.',
    userImpact:
      'A tooltip that vanishes when you try to move onto it is unreadable to a magnifier user, who may only see part of it at a time. One that cannot be dismissed can cover the content underneath indefinitely.',
    commonFailures: [
      'Tooltips that disappear the moment the pointer leaves the trigger',
      'Popovers with no Escape handling',
      'Hover menus that obscure content with no way to close them',
      'Tooltips that time out while still being read',
    ],
    testability: 'machine-assisted',
    detectionCoverage: [{ checkId: 'ui.hover-content', class: 'detects-failures' }],
    manualProcedure:
      'Trigger each tooltip or popover, then try to move the pointer onto it, dismiss it with Escape, and leave it alone to see whether it times out.',
    en301549: '9.1.4.13',
    section508: false,
    applicability: requiresSignal('hasHoverOrFocusContent'),
  }),
] satisfies readonly SuccessCriterion[];
