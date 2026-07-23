import { z } from 'zod';

import { FindingSchema, type Severity, type Tier } from './finding.js';
import { CheckIdSchema, FindingIdSchema, IsoTimestampSchema, ScIdSchema } from './primitives.js';
import { ScanRecordSchema } from './scan.js';
import { WcagLevelSchema } from './primitives.js';

/**
 * Per-criterion outcome. This rollup, not a number out of 100, is the product.
 *
 * - `fail`           — at least one violation or likely finding.
 * - `needs-review`   — something was flagged that a human must adjudicate.
 * - `pass`           — positively evidenced. Absence of findings is not a pass.
 * - `not-applicable` — an applicability detector says the criterion cannot apply here.
 * - `not-tested`     — no automated coverage. Listed explicitly, never hidden.
 */
export const ScStatusSchema = z.enum([
  'fail',
  'needs-review',
  'pass',
  'not-applicable',
  'not-tested',
]);
export type ScStatus = z.infer<typeof ScStatusSchema>;

/** Precedence for combining several checks' opinions about one criterion. Worst wins. */
export const SC_STATUS_PRECEDENCE: readonly ScStatus[] = [
  'fail',
  'needs-review',
  'pass',
  'not-applicable',
  'not-tested',
];

/** Combines per-check outcomes into the criterion's status, worst-first. */
export function rollUpScStatus(statuses: readonly ScStatus[]): ScStatus {
  for (const candidate of SC_STATUS_PRECEDENCE) {
    if (statuses.includes(candidate)) return candidate;
  }
  return 'not-tested';
}

export const ScRollupSchema = z.object({
  sc: ScIdSchema,
  level: WcagLevelSchema,
  status: ScStatusSchema,
  findingIds: z.array(FindingIdSchema).default([]),
  /** Which checks contributed. Empty means nothing automated covers this criterion. */
  checksRun: z.array(CheckIdSchema).default([]),
  /** One sentence a reader can act on, especially for `not-tested` and `not-applicable`. */
  rationale: z.string().min(1).max(2000),
});
export type ScRollup = z.infer<typeof ScRollupSchema>;

/**
 * The honesty ledger. Every criterion in the target level appears in exactly one
 * bucket, and the totals must add up — enforced below.
 */
export const CoverageLedgerSchema = z
  .object({
    criteriaTotal: z.int().positive(),
    evaluated: z.int().nonnegative(),
    passVerified: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    needsReview: z.int().nonnegative(),
    notApplicable: z.int().nonnegative(),
    notTested: z.int().nonnegative(),
    /** Criteria that require a human. The generated checklist covers exactly these. */
    manualRequired: z.array(ScIdSchema).default([]),
  })
  .check((ctx) => {
    const v = ctx.value;
    const sum = v.passVerified + v.failed + v.needsReview + v.notApplicable + v.notTested;
    if (sum !== v.criteriaTotal) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['criteriaTotal'],
        message: `coverage buckets sum to ${String(sum)} but criteriaTotal is ${String(v.criteriaTotal)}; every criterion must be accounted for`,
      });
    }
    if (v.evaluated !== v.criteriaTotal - v.notTested) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['evaluated'],
        message: 'evaluated must equal criteriaTotal minus notTested',
      });
    }
  });
export type CoverageLedger = z.infer<typeof CoverageLedgerSchema>;

/** The one sentence that leads every Handrail report. */
export function coverageHeadline(ledger: CoverageLedger): string {
  return (
    `Automatically evaluated ${String(ledger.evaluated)} of ${String(ledger.criteriaTotal)} ` +
    `A/AA criteria (${String(ledger.passVerified)} pass-verified, ${String(ledger.failed)} fail, ` +
    `${String(ledger.needsReview)} need review); ${String(ledger.notTested)} require human testing.`
  );
}

/**
 * A trend number for watching one codebase over time. It is deliberately *not*
 * called an accessibility score and must never be presented as one: no automated
 * tool can measure whether a site is usable, and a single number invites exactly
 * that misreading.
 */
export const TrendScoreSchema = z.object({
  value: z.number().min(0).max(100),
  disclaimer: z
    .literal(
      'Trend indicator for tracking one codebase over time. Not an accessibility score, ' +
        'not a conformance claim, and not comparable between sites.',
    )
    .default(
      'Trend indicator for tracking one codebase over time. Not an accessibility score, ' +
        'not a conformance claim, and not comparable between sites.',
    ),
});
export type TrendScore = z.infer<typeof TrendScoreSchema>;

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  serious: 15,
  moderate: 8,
  minor: 3,
};

/**
 * Severity-weighted logarithmic deduction: the tenth instance of a problem
 * should not cost ten times the first, because it is usually the same component.
 * Only findings Handrail stands behind (`violation`, `likely`) deduct.
 */
export function computeTrendScore(
  findings: readonly { severity: Severity; tier: Tier }[],
): number {
  const counts = new Map<Severity, number>();
  for (const finding of findings) {
    if (finding.tier === 'needs-review') continue;
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  let deduction = 0;
  for (const [severity, count] of counts) {
    deduction += SEVERITY_WEIGHT[severity] * Math.log2(count + 1);
  }
  return Math.max(0, Math.round((100 - deduction) * 10) / 10);
}

/**
 * The canonical artifact. `report.html`, SARIF, the PR summary, the human review
 * checklist and the OpenACR draft are all rendered from this one file, so that
 * every surface tells the same story.
 */
export const ReportSchema = z.object({
  reportVersion: z.literal(1),
  generatedAt: IsoTimestampSchema,
  tool: z.object({
    name: z.literal('handrail'),
    version: z.string().min(1),
  }),
  scan: ScanRecordSchema,
  findings: z.array(FindingSchema).default([]),
  scRollups: z.array(ScRollupSchema).default([]),
  coverage: CoverageLedgerSchema,
  trendScore: TrendScoreSchema,
});
export type Report = z.infer<typeof ReportSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
