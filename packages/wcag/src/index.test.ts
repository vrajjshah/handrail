import { ScIdSchema, CheckIdSchema } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import {
  ALL_CRITERIA,
  CRITERIA,
  CRITERIA_COUNT,
  SC_IDS,
  allReferencedCheckIds,
  applicabilityFor,
  coverageMatrix,
  coverageSummary,
  criteriaForCheck,
  criteriaForLevel,
  criteriaForPrinciple,
  findCriterion,
  getCriterion,
} from './index.js';
import type { ApplicabilitySignals } from './types.js';

/** Everything false, nothing found — the shape a scan of an empty page produces. */
const NO_SIGNALS: ApplicabilitySignals = {
  hasImages: false,
  hasPrerecordedAudio: false,
  hasPrerecordedVideo: false,
  hasLiveMedia: false,
  hasAudioAutoplay: false,
  hasForms: false,
  hasLinks: false,
  hasHeadings: false,
  hasTables: false,
  hasFramesOrIframes: false,
  hasTimeLimits: false,
  hasMovingContent: false,
  hasFlashingContent: false,
  hasPointerGestures: false,
  hasDragInteractions: false,
  hasMotionActuation: false,
  hasKeyboardShortcuts: false,
  hasHoverOrFocusContent: false,
  hasAuthentication: false,
  hasMultiStepProcess: false,
  hasLegalOrFinancialCommitment: false,
  hasForeignLanguagePassages: false,
  hasHelpMechanism: false,
  pagesInScan: 1,
};

describe('the denominator', () => {
  it('is 55 criteria: 31 at A, 24 at AA', () => {
    expect(CRITERIA_COUNT).toEqual({ total: 55, A: 31, AA: 24 });
  });

  it('reconciles to 55 across the three WCAG versions', () => {
    const bySince = (v: '2.0' | '2.1' | '2.2') =>
      ALL_CRITERIA.filter((c) => c.since === v).length;

    // WCAG 2.0 contributed 38 A/AA criteria; 4.1.1 Parsing was removed in 2.2.
    expect(bySince('2.0')).toBe(37);
    expect(bySince('2.1')).toBe(12);
    expect(bySince('2.2')).toBe(6);
    expect(bySince('2.0') + bySince('2.1') + bySince('2.2')).toBe(55);
  });

  it('splits 31/24 rather than the 30/25 a WCAG 2.1 reference would give', () => {
    // The trap: 4.1.1 (Level A) was removed and 3.2.6 + 3.3.7 (both Level A)
    // were added, so the Level A count moved 30 -> 31 while the total stayed 55.
    expect(getCriterion('3.2.6').level).toBe('A');
    expect(getCriterion('3.3.7').level).toBe('A');
    expect(findCriterion('4.1.1')).toBeUndefined();
  });

  it('has no duplicates', () => {
    expect(new Set(SC_IDS).size).toBe(55);
  });

  it('does not include 4.1.1 Parsing, which WCAG 2.2 removed', () => {
    expect(findCriterion('4.1.1')).toBeUndefined();
  });

  it('includes all six criteria WCAG 2.2 added', () => {
    for (const num of ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8'] as const) {
      expect(getCriterion(num).since).toBe('2.2');
    }
  });

  it('targeting AA includes Level A, because conformance is cumulative', () => {
    expect(criteriaForLevel('AA')).toHaveLength(55);
    expect(criteriaForLevel('A')).toHaveLength(31);
    expect(criteriaForLevel('A').every((c) => c.level === 'A')).toBe(true);
  });

  it('accounts for every criterion under exactly one principle', () => {
    const counts = (['perceivable', 'operable', 'understandable', 'robust'] as const).map(
      (p) => criteriaForPrinciple(p).length,
    );

    expect(counts).toEqual([20, 20, 13, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(55);
  });
});

describe('record integrity', () => {
  it('gives every criterion a branded id that matches its number', () => {
    for (const criterion of ALL_CRITERIA) {
      expect(() => ScIdSchema.parse(criterion.id)).not.toThrow();
      expect(String(criterion.id)).toBe(criterion.num);
    }
  });

  it('keys CRITERIA by the criterion number', () => {
    for (const num of SC_IDS) {
      expect(CRITERIA[num].num).toBe(num);
    }
  });

  it('gives every criterion the prose a report needs', () => {
    for (const criterion of ALL_CRITERIA) {
      expect(criterion.title.length, criterion.num).toBeGreaterThan(0);
      expect(criterion.understanding.length, criterion.num).toBeGreaterThan(40);
      expect(criterion.userImpact.length, criterion.num).toBeGreaterThan(40);
      expect(criterion.manualProcedure.length, criterion.num).toBeGreaterThan(30);
      expect(criterion.commonFailures.length, criterion.num).toBeGreaterThan(0);
    }
  });

  it('uses only well-formed check ids', () => {
    for (const checkId of allReferencedCheckIds()) {
      expect(() => CheckIdSchema.parse(checkId), checkId).not.toThrow();
    }
  });

  it('states a guideline consistent with the criterion number', () => {
    for (const criterion of ALL_CRITERIA) {
      const guidelineNumber = criterion.num.split('.').slice(0, 2).join('.');
      expect(criterion.guideline.startsWith(guidelineNumber), criterion.num).toBe(true);
    }
  });
});

describe('legal mappings', () => {
  it('scopes Section 508 to WCAG 2.0, so the 18 later additions are out', () => {
    const inScope = ALL_CRITERIA.filter((c) => c.section508);
    const outOfScope = ALL_CRITERIA.filter((c) => !c.section508);

    expect(inScope).toHaveLength(37);
    expect(outOfScope).toHaveLength(18);
    expect(inScope.every((c) => c.since === '2.0')).toBe(true);
    expect(outOfScope.every((c) => c.since !== '2.0')).toBe(true);
  });

  it('maps EN 301 549 clause 9.<sc> for everything it covers', () => {
    for (const criterion of ALL_CRITERIA) {
      if (criterion.en301549 === null) continue;
      expect(criterion.en301549, criterion.num).toBe(`9.${criterion.num}`);
    }
  });

  it('leaves EN 301 549 null for exactly the WCAG 2.2 additions', () => {
    const unmapped = ALL_CRITERIA.filter((c) => c.en301549 === null).map((c) => c.num);

    expect(unmapped.sort()).toEqual(['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']);
  });
});

describe('coverageMatrix', () => {
  it('covers every criterion in the target level', () => {
    expect(coverageMatrix('AA')).toHaveLength(55);
    expect(coverageMatrix('A')).toHaveLength(31);
  });

  it('reports the strongest available conclusion per criterion', () => {
    const byId = new Map(coverageMatrix().map((e) => [e.sc, e]));

    // reflow-320 decides outright
    expect(byId.get('1.4.10')?.best).toBe('decides');
    // 1.1.1 has axe (failure detection) and vision (candidates) — failures wins
    expect(byId.get('1.1.1')?.best).toBe('detects-failures');
    // nothing automated can touch prerecorded captions
    expect(byId.get('1.2.2')?.best).toBe('none');
  });

  it('only lets a decides-class check justify an automated pass', () => {
    for (const entry of coverageMatrix()) {
      expect(entry.canAutoPass, entry.sc).toBe(entry.best === 'decides');
    }
  });

  it('flags every human-only criterion as requiring a human', () => {
    for (const entry of coverageMatrix()) {
      if (entry.testability === 'human-only') {
        expect(entry.requiresHuman, entry.sc).toBe(true);
      }
    }
  });

  it('never claims coverage for a criterion with no checks', () => {
    for (const entry of coverageMatrix()) {
      if (entry.checks.length === 0) {
        expect(entry.best, entry.sc).toBe('none');
        expect(entry.canAutoPass, entry.sc).toBe(false);
      }
    }
  });
});

describe('coverageSummary', () => {
  const summary = coverageSummary('AA');

  it('never claims more coverage than there are criteria', () => {
    expect(summary.criteriaTotal).toBe(55);
    expect(summary.withAnyCoverage).toBeLessThanOrEqual(55);
    expect(summary.autoPassable).toBeLessThanOrEqual(summary.withAnyCoverage);
  });

  it('lists the uncovered criteria rather than hiding them in a number', () => {
    expect(summary.uncovered.length).toBe(55 - summary.withAnyCoverage);
    expect(summary.uncovered).toContain('1.2.2');
  });

  it('reports the criteria no tool can ever decide', () => {
    // Time-based media and error prevention need a human, always.
    expect(summary.humanOnly).toEqual(
      expect.arrayContaining(['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '2.3.1', '3.3.4']),
    );
    for (const sc of summary.humanOnly) {
      expect(coverageSummary('AA').autoPassable).toBeGreaterThanOrEqual(0);
      expect(CRITERIA[sc].testability).toBe('human-only');
    }
  });
});

describe('criteriaForCheck', () => {
  it('finds every criterion a check contributes to', () => {
    expect(criteriaForCheck('kbd.walk').map((c) => c.num).sort()).toEqual(['2.1.1', '2.4.3']);
    expect(criteriaForCheck('resp.reflow-320').map((c) => c.num)).toEqual(['1.4.10']);
  });

  it('returns nothing for a check the reference does not know', () => {
    expect(criteriaForCheck('nope.not-a-check')).toEqual([]);
  });
});

describe('applicability', () => {
  const empty = applicabilityFor(NO_SIGNALS);

  it('keeps criteria that always apply applicable', () => {
    expect(empty.get('1.4.3')).toBe('applicable');
    expect(empty.get('2.1.1')).toBe('applicable');
    expect(empty.get('4.1.2')).toBe('applicable');
  });

  it('prefers unknown over not-applicable when a signal is merely absent', () => {
    // We saw no video — but the crawler may simply not have reached it.
    expect(empty.get('1.2.2')).toBe('unknown');
    expect(empty.get('3.3.8')).toBe('unknown');
  });

  it('rules out site-level criteria on a single-page scan, where absence is certain', () => {
    expect(empty.get('3.2.3')).toBe('not-applicable');
    expect(empty.get('3.2.4')).toBe('not-applicable');
  });

  it('turns criteria on when their signal appears', () => {
    const withMedia = applicabilityFor({ ...NO_SIGNALS, hasPrerecordedVideo: true });
    expect(withMedia.get('1.2.2')).toBe('applicable');
    expect(withMedia.get('1.2.5')).toBe('applicable');

    const multiPage = applicabilityFor({ ...NO_SIGNALS, pagesInScan: 12 });
    expect(multiPage.get('3.2.3')).toBe('applicable');
    expect(multiPage.get('2.4.5')).toBe('applicable');
  });

  it('covers every criterion in the target level', () => {
    expect(empty.size).toBe(55);
    expect(applicabilityFor(NO_SIGNALS, 'A').size).toBe(31);
  });
});
