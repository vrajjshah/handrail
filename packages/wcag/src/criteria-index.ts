import type { CheckId, ScId, WcagLevel } from '@handrail/schemas';

import { OPERABLE } from './criteria/operable.js';
import { PERCEIVABLE } from './criteria/perceivable.js';
import { ROBUST } from './criteria/robust.js';
import { UNDERSTANDABLE } from './criteria/understandable.js';
import type {
  Applicability,
  ApplicabilitySignals,
  CoverageClass,
  KnownScId,
  Principle,
  SuccessCriterion,
  TestabilityClass,
} from './types.js';

/** Every A/AA criterion, in specification order. */
export const ALL_CRITERIA = [
  ...PERCEIVABLE,
  ...OPERABLE,
  ...UNDERSTANDABLE,
  ...ROBUST,
] as const;

/**
 * Compile-time completeness, in both directions.
 *
 * `MustEqual` resolves to `true` only when the set of criterion numbers actually
 * defined is *exactly* {@link KnownScId}. Forget to add a criterion and this line
 * fails to typecheck; add one that is not in the union and it fails too.
 *
 * This is the guard the whole package exists for. Coverage reporting is only
 * honest if the denominator is right, and "38 of 55" is a very different claim
 * from "38 of 54" — silently wrong in a way no test of the *findings* would catch.
 */
type DefinedScId = (typeof ALL_CRITERIA)[number]['num'];
type MustEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _allCriteriaAreExactlyKnownScIds: MustEqual<DefinedScId, KnownScId> = true;
void _allCriteriaAreExactlyKnownScIds;

/**
 * The criteria, keyed by number.
 *
 * The assertion is sound because `_allCriteriaAreExactlyKnownScIds` above proves
 * the key set matches — without that proof this cast would be exactly the kind of
 * quiet lie the package is meant to prevent.
 */
export const CRITERIA = Object.fromEntries(ALL_CRITERIA.map((c) => [c.num, c])) as Record<
  KnownScId,
  SuccessCriterion
>;

/** Criterion numbers in specification order. */
export const SC_IDS: readonly KnownScId[] = ALL_CRITERIA.map((c) => c.num);

/** How many criteria exist at each level. Reports quote these as the denominator. */
export const CRITERIA_COUNT = {
  total: ALL_CRITERIA.length,
  A: ALL_CRITERIA.filter((c) => c.level === 'A').length,
  AA: ALL_CRITERIA.filter((c) => c.level === 'AA').length,
} as const;

export function getCriterion(num: KnownScId): SuccessCriterion {
  return CRITERIA[num];
}

/** Looks a criterion up from an unbranded or branded string, if it is one we know. */
export function findCriterion(num: string | ScId): SuccessCriterion | undefined {
  return Object.hasOwn(CRITERIA, num) ? CRITERIA[num as KnownScId] : undefined;
}

/**
 * Criteria in scope for a conformance target.
 *
 * Targeting AA includes Level A — conformance is cumulative, and a report that
 * lists only the 25 AA criteria has quietly dropped the 30 that matter most.
 */
export function criteriaForLevel(level: WcagLevel): readonly SuccessCriterion[] {
  return level === 'A' ? ALL_CRITERIA.filter((c) => c.level === 'A') : ALL_CRITERIA;
}

export function criteriaForPrinciple(principle: Principle): readonly SuccessCriterion[] {
  return ALL_CRITERIA.filter((c) => c.principle === principle);
}

/** Every criterion a given check contributes to. */
export function criteriaForCheck(checkId: CheckId): readonly SuccessCriterion[] {
  return ALL_CRITERIA.filter((c) => c.detectionCoverage.some((d) => d.checkId === checkId));
}

/** Every check id referenced anywhere in the reference, deduplicated and sorted. */
export function allReferencedCheckIds(): readonly CheckId[] {
  const ids = new Set<CheckId>();
  for (const criterion of ALL_CRITERIA) {
    for (const coverage of criterion.detectionCoverage) ids.add(coverage.checkId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

const COVERAGE_STRENGTH: Record<CoverageClass, number> = {
  'surfaces-candidates': 1,
  'detects-failures': 2,
  decides: 3,
};

export interface CoverageEntry {
  sc: KnownScId;
  title: string;
  level: WcagLevel;
  principle: Principle;
  testability: TestabilityClass;
  checks: readonly CheckId[];
  /** The strongest conclusion any of our checks can reach for this criterion. */
  best: CoverageClass | 'none';
  /**
   * Whether automation can ever justify reporting this criterion as `pass`.
   * Only a `decides`-class check can, because absence of findings from a
   * failure-detector proves nothing.
   */
  canAutoPass: boolean;
  /** Whether a human must look regardless of what automation reports. */
  requiresHuman: boolean;
}

/**
 * The honesty ledger, per criterion.
 *
 * This is what turns "we ran some checks" into "we evaluated 38 of 55 criteria
 * and here are the 17 we did not". Every report headline is derived from it.
 */
export function coverageMatrix(level: WcagLevel = 'AA'): readonly CoverageEntry[] {
  return criteriaForLevel(level).map((criterion) => {
    const checks = criterion.detectionCoverage;
    const best = checks.reduce<CoverageClass | 'none'>((strongest, coverage) => {
      if (strongest === 'none') return coverage.class;
      return COVERAGE_STRENGTH[coverage.class] > COVERAGE_STRENGTH[strongest]
        ? coverage.class
        : strongest;
    }, 'none');

    return {
      sc: criterion.num,
      title: criterion.title,
      level: criterion.level,
      principle: criterion.principle,
      testability: criterion.testability,
      checks: checks.map((c) => c.checkId),
      best,
      canAutoPass: best === 'decides',
      requiresHuman: criterion.testability !== 'machine-decidable' || best !== 'decides',
    };
  });
}

export interface CoverageSummary {
  level: WcagLevel;
  criteriaTotal: number;
  /** Criteria with at least one contributing check. */
  withAnyCoverage: number;
  /** Criteria where automation alone can report a verified pass. */
  autoPassable: number;
  /** Criteria with no automated coverage at all — the honest "not tested" set. */
  uncovered: readonly KnownScId[];
  /** Criteria no tool can ever decide, however good it gets. */
  humanOnly: readonly KnownScId[];
}

export function coverageSummary(level: WcagLevel = 'AA'): CoverageSummary {
  const matrix = coverageMatrix(level);
  return {
    level,
    criteriaTotal: matrix.length,
    withAnyCoverage: matrix.filter((e) => e.best !== 'none').length,
    autoPassable: matrix.filter((e) => e.canAutoPass).length,
    uncovered: matrix.filter((e) => e.best === 'none').map((e) => e.sc),
    humanOnly: matrix.filter((e) => e.testability === 'human-only').map((e) => e.sc),
  };
}

/**
 * Runs every applicability detector against one scan's signals.
 *
 * Detectors lean towards `unknown` rather than `not-applicable`: saying "this
 * site has no video, so captions do not apply" is a claim about the whole site,
 * and it is wrong the moment the crawler missed a page. `unknown` keeps the
 * criterion on the human checklist, which is the safe direction to be wrong in.
 */
export function applicabilityFor(
  signals: ApplicabilitySignals,
  level: WcagLevel = 'AA',
): ReadonlyMap<KnownScId, Applicability> {
  return new Map(criteriaForLevel(level).map((c) => [c.num, c.applicability(signals)]));
}
