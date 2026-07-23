import type { CheckId, ScId, WcagLevel } from '@handrail/schemas';

/**
 * Every WCAG 2.2 success criterion at Level A and AA — 31 and 24 respectively.
 *
 * This union is the whole point of the package: `Record<KnownScId, SuccessCriterion>`
 * turns a missing criterion into a compile error rather than a silent gap that
 * nobody notices until a report under-reports its own denominator.
 *
 * Two things about the 2.2 list that a reference built against 2.1 gets wrong:
 * **4.1.1 Parsing was removed** (it was obsolete — browsers recover from the
 * markup errors it described), and six criteria were **added** (2.4.11, 2.5.7,
 * 2.5.8, 3.2.6, 3.3.7, 3.3.8).
 *
 * Those two changes are why the split is **31 A / 24 AA** and not the 30/25 you
 * get by carrying a WCAG 2.1 reference forward: 4.1.1 was Level A, and two of
 * the six additions (3.2.6, 3.3.7) are Level A as well. The total lands on 55
 * either way, which is what makes the mistake easy to miss.
 */
export type KnownScId =
  // Principle 1 — Perceivable
  | '1.1.1'
  | '1.2.1'
  | '1.2.2'
  | '1.2.3'
  | '1.2.4'
  | '1.2.5'
  | '1.3.1'
  | '1.3.2'
  | '1.3.3'
  | '1.3.4'
  | '1.3.5'
  | '1.4.1'
  | '1.4.2'
  | '1.4.3'
  | '1.4.4'
  | '1.4.5'
  | '1.4.10'
  | '1.4.11'
  | '1.4.12'
  | '1.4.13'
  // Principle 2 — Operable
  | '2.1.1'
  | '2.1.2'
  | '2.1.4'
  | '2.2.1'
  | '2.2.2'
  | '2.3.1'
  | '2.4.1'
  | '2.4.2'
  | '2.4.3'
  | '2.4.4'
  | '2.4.5'
  | '2.4.6'
  | '2.4.7'
  | '2.4.11'
  | '2.5.1'
  | '2.5.2'
  | '2.5.3'
  | '2.5.4'
  | '2.5.7'
  | '2.5.8'
  // Principle 3 — Understandable
  | '3.1.1'
  | '3.1.2'
  | '3.2.1'
  | '3.2.2'
  | '3.2.3'
  | '3.2.4'
  | '3.2.6'
  | '3.3.1'
  | '3.3.2'
  | '3.3.3'
  | '3.3.4'
  | '3.3.7'
  | '3.3.8'
  // Principle 4 — Robust
  | '4.1.2'
  | '4.1.3';

export const PRINCIPLES = ['perceivable', 'operable', 'understandable', 'robust'] as const;
export type Principle = (typeof PRINCIPLES)[number];

/**
 * How decidable the criterion is *in principle*, independent of what Handrail
 * happens to implement. This is the honest ceiling on automation.
 *
 * - `machine-decidable` — a correct implementation can decide it outright.
 *   Missing `lang`, duplicate ids, contrast of plain text on a solid background.
 * - `machine-assisted` — a machine can find candidates or rule out the easy
 *   cases, but a human decides. "Is this alt text *accurate*" lives here.
 * - `human-only` — no amount of engineering settles it. Whether a captioned
 *   video's captions are correct; whether a form's instructions are
 *   comprehensible to the people who use it.
 *
 * A tool that claims a `human-only` criterion passed is lying, however
 * confidently. `not-tested` is the right answer for those.
 */
export const TESTABILITY_CLASSES = ['machine-decidable', 'machine-assisted', 'human-only'] as const;
export type TestabilityClass = (typeof TESTABILITY_CLASSES)[number];

/**
 * What one of Handrail's checks actually contributes to a criterion.
 *
 * - `decides` — the check can produce both a fail and an evidenced pass.
 * - `detects-failures` — it can find failures but its silence proves nothing,
 *   so it can never justify a `pass`. Most rule-engine checks are this.
 * - `surfaces-candidates` — it produces things a human should look at, capped
 *   at `needs-review`.
 */
export const COVERAGE_CLASSES = ['decides', 'detects-failures', 'surfaces-candidates'] as const;
export type CoverageClass = (typeof COVERAGE_CLASSES)[number];

export interface DetectionCoverage {
  checkId: CheckId;
  class: CoverageClass;
  /**
   * Who makes the criterion attribution.
   *
   * `tool` — the default — means the underlying engine tags the rule with this
   * criterion itself, so the claim is checkable against the tool's own metadata.
   * `handrail` means we attribute it further than the tool does: axe tags its
   * `label` rule only 4.1.2, for instance, but a form field with no label is the
   * textbook 3.3.2 failure (WCAG failure technique F68).
   *
   * Marking the difference is the point. A report can then say which claims come
   * from the tool and which are ours, and `axe.test.ts` enforces the distinction
   * in both directions — an unmarked claim axe does not make fails, and a marked
   * claim axe *does* make fails too, so the annotations cannot go stale.
   */
  attribution?: 'tool' | 'handrail';
}

/**
 * Structural facts about a captured page, computed by `@handrail/engine` and
 * handed to the applicability detectors here.
 *
 * This interface is the seam that keeps the layering rule intact: `@handrail/wcag`
 * sits below the engine and must not import it, so the engine satisfies this
 * shape rather than the reference reaching into a capture.
 *
 * Every field is a *signal*, not a verdict. `hasVideo: false` means we saw no
 * video, which is why the detectors return `unknown` rather than
 * `not-applicable` whenever absence could just mean we did not look hard enough.
 */
export interface ApplicabilitySignals {
  hasImages: boolean;
  hasPrerecordedAudio: boolean;
  hasPrerecordedVideo: boolean;
  hasLiveMedia: boolean;
  hasAudioAutoplay: boolean;
  hasForms: boolean;
  hasLinks: boolean;
  hasHeadings: boolean;
  hasTables: boolean;
  hasFramesOrIframes: boolean;
  hasTimeLimits: boolean;
  hasMovingContent: boolean;
  hasFlashingContent: boolean;
  hasPointerGestures: boolean;
  hasDragInteractions: boolean;
  hasMotionActuation: boolean;
  hasKeyboardShortcuts: boolean;
  hasHoverOrFocusContent: boolean;
  hasAuthentication: boolean;
  hasMultiStepProcess: boolean;
  hasLegalOrFinancialCommitment: boolean;
  hasForeignLanguagePassages: boolean;
  hasHelpMechanism: boolean;
  /** Site-level criteria are meaningless on a single page. */
  pagesInScan: number;
}

/** A criterion may not apply to a given target at all — but only if we can tell. */
export const APPLICABILITY = ['applicable', 'not-applicable', 'unknown'] as const;
export type Applicability = (typeof APPLICABILITY)[number];

export type ApplicabilityDetector = (signals: ApplicabilitySignals) => Applicability;

export interface SuccessCriterion {
  id: ScId;
  /** e.g. "1.4.3" — the same value as `id`, unbranded, for display and keys. */
  num: KnownScId;
  title: string;
  level: WcagLevel;
  principle: Principle;
  /** The guideline this criterion sits under, e.g. "1.4 Distinguishable". */
  guideline: string;
  /** What the criterion actually requires, in one or two plain sentences. */
  understanding: string;
  /** Who is harmed when it fails, and how. This is what belongs in a report. */
  userImpact: string;
  /** Concrete, recognisable ways this fails in the wild. */
  commonFailures: readonly string[];
  testability: TestabilityClass;
  /** Which Handrail checks contribute, and what each can honestly conclude. */
  detectionCoverage: readonly DetectionCoverage[];
  /** What a human has to do to settle the part automation cannot. */
  manualProcedure: string;
  /**
   * EN 301 549 clause. Clause 9 adopts WCAG A/AA for web content, numbered
   * `9.<sc>`. `null` for the six criteria WCAG 2.2 added, which the current
   * published EN 301 549 does not yet reference — an honest gap, not an omission.
   */
  en301549: string | null;
  /**
   * True when the criterion is in scope for the US Section 508 refresh, which
   * incorporates **WCAG 2.0** A/AA by reference. Everything added in WCAG 2.1
   * and 2.2 is therefore `false` — 18 of the 55.
   */
  section508: boolean;
  /** Added in this version of WCAG. Useful for explaining an unfamiliar criterion. */
  since: '2.0' | '2.1' | '2.2';
  applicability: ApplicabilityDetector;
}

/** The default detector: assume it applies unless something says otherwise. */
export const ALWAYS_APPLICABLE: ApplicabilityDetector = () => 'applicable';

/**
 * Builds a detector that reports `not-applicable` only when a signal is
 * definitively absent, and `unknown` otherwise.
 *
 * The asymmetry is deliberate. Claiming "no video on this site, so captions
 * don't apply" is a real claim about the site, and it is wrong the moment the
 * crawler missed a page. `unknown` keeps the criterion in the human checklist,
 * which is the safe direction to be wrong in.
 */
export function requiresSignal(
  signal: keyof ApplicabilitySignals,
  confidence: 'certain' | 'best-effort' = 'best-effort',
): ApplicabilityDetector {
  return (signals) => {
    const value = signals[signal];
    if (value === true || (typeof value === 'number' && value > 1)) return 'applicable';
    return confidence === 'certain' ? 'not-applicable' : 'unknown';
  };
}
