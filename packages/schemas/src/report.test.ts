import { describe, expect, it } from 'vitest';

import {
  CoverageLedgerSchema,
  computeTrendScore,
  coverageHeadline,
  rollUpScStatus,
} from './report.js';

describe('rollUpScStatus', () => {
  it('lets the worst outcome win', () => {
    expect(rollUpScStatus(['pass', 'fail', 'needs-review'])).toBe('fail');
    expect(rollUpScStatus(['pass', 'needs-review'])).toBe('needs-review');
    expect(rollUpScStatus(['pass', 'not-applicable'])).toBe('pass');
    expect(rollUpScStatus(['not-applicable', 'not-tested'])).toBe('not-applicable');
  });

  it('treats a criterion nothing looked at as not-tested', () => {
    expect(rollUpScStatus([])).toBe('not-tested');
  });
});

describe('CoverageLedgerSchema', () => {
  const ledger = {
    criteriaTotal: 55,
    evaluated: 38,
    passVerified: 24,
    failed: 6,
    needsReview: 8,
    notApplicable: 0,
    notTested: 17,
  };

  it('accepts a ledger whose buckets account for every criterion', () => {
    expect(() => CoverageLedgerSchema.parse(ledger)).not.toThrow();
  });

  it('rejects a ledger that quietly loses criteria', () => {
    expect(() => CoverageLedgerSchema.parse({ ...ledger, notTested: 10 })).toThrow(
      /every criterion must be accounted for/,
    );
  });

  it('rejects an evaluated count that disagrees with the not-tested count', () => {
    expect(() =>
      CoverageLedgerSchema.parse({
        ...ledger,
        evaluated: 55,
      }),
    ).toThrow(/evaluated must equal criteriaTotal minus notTested/);
  });

  it('writes the headline that leads every report', () => {
    expect(coverageHeadline(CoverageLedgerSchema.parse(ledger))).toBe(
      'Automatically evaluated 38 of 55 A/AA criteria (24 pass-verified, 6 fail, 8 need review); ' +
        '17 require human testing.',
    );
  });
});

describe('computeTrendScore', () => {
  it('is 100 for a clean run', () => {
    expect(computeTrendScore([])).toBe(100);
  });

  it('ignores needs-review findings, which Handrail does not stand behind', () => {
    expect(
      computeTrendScore([
        { severity: 'critical', tier: 'needs-review' },
        { severity: 'critical', tier: 'needs-review' },
      ]),
    ).toBe(100);
  });

  it('deducts more for a critical than for a minor', () => {
    const critical = computeTrendScore([{ severity: 'critical', tier: 'violation' }]);
    const minor = computeTrendScore([{ severity: 'minor', tier: 'violation' }]);

    expect(critical).toBeLessThan(minor);
  });

  it('damps repeats, because ten instances are usually one component', () => {
    const one = 100 - computeTrendScore([{ severity: 'serious', tier: 'violation' }]);
    const ten = 100 - computeTrendScore(
      Array.from({ length: 10 }, () => ({ severity: 'serious', tier: 'violation' }) as const),
    );

    expect(ten).toBeGreaterThan(one);
    expect(ten).toBeLessThan(one * 10);
  });

  it('never goes below zero', () => {
    const many = Array.from(
      { length: 500 },
      () => ({ severity: 'critical', tier: 'violation' }) as const,
    );

    expect(computeTrendScore(many)).toBe(0);
  });

  it('counts likely findings alongside violations', () => {
    expect(computeTrendScore([{ severity: 'serious', tier: 'likely' }])).toBeLessThan(100);
  });
});
