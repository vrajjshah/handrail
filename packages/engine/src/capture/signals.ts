import type { ApplicabilitySignals } from '@handrail/wcag';

import type { StateCapture } from './types.js';

/**
 * Derives the applicability signals `@handrail/wcag` needs from a capture.
 *
 * This is the engine's half of the seam: the engine knows what is on the page,
 * the reference knows what that means for each criterion, and neither imports
 * the other's internals.
 *
 * **Every signal here is "we saw it", never "it is not there."** A `false` means
 * this capture found nothing, which is why the detectors on the other side turn
 * most absences into `unknown` rather than `not-applicable`. The asymmetry is the
 * whole point: over-reporting a criterion as needing human review is cheap, and
 * silently excusing a site from captions because the crawler missed the video
 * page is not.
 */
export function deriveApplicabilitySignals(
  captures: readonly StateCapture[],
  pagesInScan: number,
): ApplicabilitySignals {
  const elements = captures.flatMap((c) => c.elements);
  const media = captures.map((c) => c.media);

  const sum = (pick: (m: StateCapture['media']) => number): number =>
    media.reduce((total, m) => total + pick(m), 0);

  const anyElement = (predicate: (el: StateCapture['elements'][number]) => boolean): boolean =>
    elements.some(predicate);

  const hasTag = (...tags: string[]): boolean => anyElement((el) => tags.includes(el.tag));

  const hasAttribute = (name: string): boolean =>
    anyElement((el) => Object.hasOwn(el.attributes, name));

  const inputTypes = new Set(
    elements.filter((el) => el.tag === 'input').map((el) => el.attributes.type ?? 'text'),
  );

  const videoOrEmbed = sum((m) => m.video) + sum((m) => m.thirdPartyMediaEmbeds);

  return {
    hasImages: sum((m) => m.images) + sum((m) => m.svg) + sum((m) => m.canvas) > 0,
    hasPrerecordedAudio: sum((m) => m.audio) > 0,
    hasPrerecordedVideo: videoOrEmbed > 0,
    // Nothing in a static capture distinguishes a live stream from a recording.
    // Reporting `false` keeps 1.2.4 on the human checklist rather than excusing it.
    hasLiveMedia: false,
    hasAudioAutoplay: sum((m) => m.autoplayingMedia) > 0,

    hasForms: hasTag('form', 'input', 'select', 'textarea'),
    hasLinks: anyElement((el) => el.tag === 'a' && Object.hasOwn(el.attributes, 'href')),
    hasHeadings: hasTag('h1', 'h2', 'h3', 'h4', 'h5', 'h6'),
    hasTables: hasTag('table'),
    hasFramesOrIframes: sum((m) => m.iframes) > 0,

    // Timing, motion and flashing need observation over time, which a single
    // capture cannot do. Left false so the criteria stay in the human checklist.
    hasTimeLimits: false,
    hasMovingContent: false,
    hasFlashingContent: false,

    // Gesture and motion handlers are not visible in markup at all. A heuristic
    // guessing from class names would be worse than admitting we cannot see them.
    hasPointerGestures: false,
    hasDragInteractions: anyElement((el) => el.attributes.draggable === 'true'),
    hasMotionActuation: false,
    hasKeyboardShortcuts: hasAttribute('accesskey'),

    hasHoverOrFocusContent: anyElement(
      (el) =>
        Object.hasOwn(el.attributes, 'title') ||
        el.attributes.role === 'tooltip' ||
        Object.hasOwn(el.attributes, 'aria-describedby'),
    ),

    hasAuthentication:
      inputTypes.has('password') ||
      anyElement((el) => (el.attributes.autocomplete ?? '').includes('password')),

    // A form spanning more than one captured page is the visible shape of a
    // multi-step process; a single-page wizard is not detectable from markup.
    hasMultiStepProcess: captures.filter((c) => c.elements.some((el) => el.tag === 'form')).length > 1,

    // Deliberately conservative: a false positive here would wrongly pull 3.3.4
    // into scope, and a false negative only leaves it as `unknown`.
    hasLegalOrFinancialCommitment:
      inputTypes.has('tel') ||
      anyElement((el) => (el.attributes.autocomplete ?? '').startsWith('cc-')),

    hasForeignLanguagePassages: (() => {
      const pageLang = captures[0]?.documentLang?.split('-')[0]?.toLowerCase();
      return anyElement((el) => {
        const lang = el.attributes.lang?.split('-')[0]?.toLowerCase();
        return lang !== undefined && lang !== pageLang;
      });
    })(),

    hasHelpMechanism: anyElement((el) => {
      const text = (el.text ?? '').toLowerCase();
      const href = (el.attributes.href ?? '').toLowerCase();
      return (
        el.tag === 'a' &&
        (/\b(help|support|contact|faq)\b/.test(text) || /\/(help|support|contact|faq)\b/.test(href))
      );
    }),

    pagesInScan,
  };
}
