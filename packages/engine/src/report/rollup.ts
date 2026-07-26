import {
  CoverageLedgerSchema,
  ScRollupSchema,
  computeTrendScore,
  rollUpScStatus,
  scId,
  type CheckId,
  type CoverageLedger,
  type Finding,
  type FindingId,
  type ScRollup,
  type ScStatus,
  type TrendScore,
  type WcagLevel,
} from '@handrail/schemas';
import {
  CRITERIA,
  applicabilityFor,
  coverageMatrix,
  criteriaForCheck,
  criteriaForLevel,
  type CoverageEntry,
  type KnownScId,
  type SuccessCriterion,
} from '@handrail/wcag';

import type { CheckRunSummary, ScoreInput } from './types.js';

/** Everything the report needs from the scoring layer, and what the score node computes. */
export interface ScoreSummary {
  level: WcagLevel;
  scRollups: ScRollup[];
  coverage: CoverageLedger;
  trendScore: TrendScore;
}

/** The tiers Handrail stands behind. A `needs-review` finding is not a failure yet. */
function isFailure(finding: Finding): boolean {
  return finding.tier === 'violation' || finding.tier === 'likely';
}

function coversCriterion(finding: Finding, num: KnownScId): boolean {
  return finding.sc.some((id) => String(id) === num);
}

/** What a check can honestly conclude about one criterion, per `@handrail/wcag`. */
function coverageClassFor(criterion: SuccessCriterion, checkId: CheckId): string | undefined {
  return criterion.detectionCoverage.find((entry) => entry.checkId === checkId)?.class;
}

/**
 * Positive evidence for a pass, or `undefined`.
 *
 * Three conditions, all required, and each one is a place a scanner usually
 * cheats. The check must be `decides`-class **for this criterion** (a
 * failure-detector's silence is not a pass, however many rules ran clean); it
 * must have examined at least one candidate (nothing found in nothing is not
 * evidence); and no finding may contradict it, which the status precedence
 * handles above this function.
 */
function passEvidenceFor(
  criterion: SuccessCriterion,
  checkRuns: readonly CheckRunSummary[],
): CheckRunSummary | undefined {
  return checkRuns.find(
    (run) =>
      run.candidatesChecked > 0 &&
      run.sc.includes(criterion.num) &&
      coverageClassFor(criterion, run.checkId) === 'decides',
  );
}

function uniqueSorted(ids: readonly CheckId[]): CheckId[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 1999)}…` : trimmed;
}

function failRationale(findings: readonly Finding[], criterion: SuccessCriterion): string {
  const failures = findings.filter(isFailure);
  const violations = failures.filter((f) => f.tier === 'violation').length;
  const likely = failures.length - violations;
  const parts = [
    violations > 0 ? `${String(violations)} measured violation(s)` : '',
    likely > 0 ? `${String(likely)} verified-likely finding(s)` : '',
  ].filter((part) => part.length > 0);
  return sentence(
    `${parts.join(' and ')} against ${criterion.num} ${criterion.title}. ${criterion.userImpact}`,
  );
}

function notTestedRationale(
  criterion: SuccessCriterion,
  entry: CoverageEntry,
  ranClean: readonly CheckId[],
): string {
  if (ranClean.length > 0) {
    return sentence(
      `${ranClean.join(', ')} ran and reported no failures, but no automated check can ` +
        `decide ${criterion.num} outright — a failure-detector's silence is not a pass. ` +
        `A human must confirm: ${criterion.manualProcedure}`,
    );
  }
  if (entry.checks.length === 0) {
    return sentence(
      `No automated check covers ${criterion.num} (${criterion.testability}). ` +
        `Manual test: ${criterion.manualProcedure}`,
    );
  }
  return sentence(
    `${entry.checks.join(', ')} cover ${criterion.num} but none of them ran on this scan, ` +
      `or none found anything to examine. Manual test: ${criterion.manualProcedure}`,
  );
}

/**
 * The per-criterion rollup — the thing this product actually sells.
 *
 * Every criterion in the conformance target gets exactly one row, including the
 * ones nothing looked at: `not-tested` is a first-class outcome that is listed,
 * never hidden. The precedence is the plan's, applied through the schema's own
 * `rollUpScStatus` so that the ordering lives in one place:
 * `fail > needs-review > pass > not-applicable > not-tested`.
 */
export function buildScRollups(input: ScoreInput): ScRollup[] {
  const level = input.level ?? 'AA';
  const checkRuns = input.checkRuns ?? [];
  const aiChecksRun = input.aiChecksRun ?? [];
  const matrix = new Map(coverageMatrix(level).map((entry) => [entry.sc, entry]));
  const applicability =
    input.signals === undefined ? undefined : applicabilityFor(input.signals, level);

  // Which criteria each AI check speaks to. AI checks never carry a candidate
  // count: they are `surfaces-candidates` class and so can never justify a pass,
  // and recording a count would only invite one.
  const aiCriteria = new Map<CheckId, readonly KnownScId[]>(
    aiChecksRun.map((checkId) => [checkId, criteriaForCheck(checkId).map((c) => c.num)]),
  );

  return criteriaForLevel(level).map((criterion) => {
    const entry = matrix.get(criterion.num);
    const findings = input.findings.filter((finding) => coversCriterion(finding, criterion.num));
    const statuses: ScStatus[] = [];

    if (findings.some(isFailure)) statuses.push('fail');
    if (findings.some((finding) => finding.tier === 'needs-review')) statuses.push('needs-review');

    const passEvidence = passEvidenceFor(criterion, checkRuns);
    if (passEvidence !== undefined) statuses.push('pass');

    if (applicability?.get(criterion.num) === 'not-applicable') statuses.push('not-applicable');

    const status = rollUpScStatus(statuses);

    const ranClean = checkRuns
      .filter((run) => run.sc.includes(criterion.num) && run.candidatesChecked > 0)
      .map((run) => run.checkId);
    const checksRun = uniqueSorted([
      ...findings.map((finding) => finding.checkId),
      ...ranClean,
      ...[...aiCriteria]
        .filter(([, criteria]) => criteria.includes(criterion.num))
        .map(([checkId]) => checkId),
    ]);

    const rationale =
      status === 'fail'
        ? failRationale(findings, criterion)
        : status === 'needs-review'
          ? sentence(
              `${String(findings.length)} finding(s) need a human decision. ` +
                `Handrail could not settle ${criterion.num} on evidence alone: ${criterion.manualProcedure}`,
            )
          : status === 'pass'
            ? sentence(
                `${passEvidence?.checkId ?? 'a check'} examined ` +
                  `${String(passEvidence?.candidatesChecked ?? 0)} candidate(s) and found no failure. ` +
                  `This check can decide ${criterion.num}, so that is a verified pass rather than silence.`,
              )
            : status === 'not-applicable'
              ? sentence(
                  `Nothing this scan captured falls under ${criterion.num}. ` +
                    `Re-check if the crawl missed part of the site.`,
                )
              : notTestedRationale(criterion, entry ?? fallbackEntry(criterion), ranClean);

    return ScRollupSchema.parse({
      sc: scId(criterion.num),
      level: criterion.level,
      status,
      findingIds: findings.map((finding) => finding.id satisfies FindingId),
      checksRun,
      rationale,
    });
  });
}

/** Only reachable if the coverage matrix and the criteria index ever disagree. */
function fallbackEntry(criterion: SuccessCriterion): CoverageEntry {
  return {
    sc: criterion.num,
    title: criterion.title,
    level: criterion.level,
    principle: criterion.principle,
    testability: criterion.testability,
    checks: criterion.detectionCoverage.map((entry) => entry.checkId),
    best: 'none',
    canAutoPass: false,
    requiresHuman: true,
  };
}

/**
 * The honesty ledger. Every criterion lands in exactly one bucket and the totals
 * must add up — `CoverageLedgerSchema` refuses to parse a ledger that does not,
 * which is what stops an under-reported denominator from ever shipping.
 *
 * `manualRequired` is broader than the headline's `notTested`: a criterion whose
 * findings are all `needs-review` also needs a human, it just needs one for a
 * different reason.
 */
export function buildCoverageLedger(rollups: readonly ScRollup[]): CoverageLedger {
  const count = (status: ScStatus): number => rollups.filter((r) => r.status === status).length;
  const notTested = count('not-tested');

  return CoverageLedgerSchema.parse({
    criteriaTotal: rollups.length,
    evaluated: rollups.length - notTested,
    passVerified: count('pass'),
    failed: count('fail'),
    needsReview: count('needs-review'),
    notApplicable: count('not-applicable'),
    notTested,
    manualRequired: rollups
      .filter((r) => r.status === 'not-tested' || r.status === 'needs-review')
      .map((r) => r.sc),
  });
}

/** Rollups, ledger and the trend indicator, in one pass. What the score node returns. */
export function buildScoreSummary(input: ScoreInput): ScoreSummary {
  const level = input.level ?? 'AA';
  const scRollups = buildScRollups({ ...input, level });
  return {
    level,
    scRollups,
    coverage: buildCoverageLedger(scRollups),
    trendScore: { value: computeTrendScore(input.findings), disclaimer: DISCLAIMER },
  };
}

/** The literal `TrendScoreSchema` requires. Spelled out so a drift is a type error. */
const DISCLAIMER =
  'Trend indicator for tracking one codebase over time. Not an accessibility score, ' +
  'not a conformance claim, and not comparable between sites.';

/** Criteria a human still has to test, with the procedure for each. */
export function manualChecklist(
  rollups: readonly ScRollup[],
): { sc: KnownScId; title: string; procedure: string; why: string }[] {
  return rollups
    .filter((rollup) => rollup.status === 'not-tested' || rollup.status === 'needs-review')
    .map((rollup) => {
      const criterion = CRITERIA[String(rollup.sc) as KnownScId];
      return {
        sc: criterion.num,
        title: criterion.title,
        procedure: criterion.manualProcedure,
        why: rollup.rationale,
      };
    });
}
