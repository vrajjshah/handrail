import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import {
  AXE_MAP,
  axeRule,
  axeRulesForCriterion,
  buildAxeMap,
  compareScNumbers,
  criteriaForAxeRule,
  criteriaWithAxeCoverage,
  criteriaWithoutAxeCoverage,
  findUnmappedRules,
  isLevelTag,
  outOfScopeAxeCriteria,
  parseScTag,
  type AxeRuleMetadata,
} from './axe.js';
import { ALL_CRITERIA, CRITERIA } from './criteria-index.js';

const liveRules = axe.getRules() as unknown as AxeRuleMetadata[];

describe('the stamp', () => {
  it('matches the installed axe-core version', () => {
    expect(AXE_MAP.stamp.axeVersion).toBe(axe.version);
  });

  it('matches a fresh rebuild, so an axe upgrade cannot change coverage silently', () => {
    // The whole point of committing a generated file: if axe adds, removes or
    // retags a rule, this fails and someone has to regenerate deliberately.
    expect(buildAxeMap(liveRules, axe.version)).toEqual(AXE_MAP);
  });

  it('leaves no A/AA-tagged axe rule mapped to nothing we encode', () => {
    expect(findUnmappedRules(liveRules)).toEqual([]);
  });

  it('reports counts consistent with the rules it contains', () => {
    expect(AXE_MAP.stamp.ruleCount).toBe(liveRules.length);
    expect(AXE_MAP.stamp.mappedRuleCount).toBe(
      AXE_MAP.rules.filter((r) => r.sc.length > 0).length,
    );
    expect(AXE_MAP.stamp.criteriaWithAxeCoverage).toBe(criteriaWithAxeCoverage().length);
  });
});

describe('parseScTag', () => {
  it('reads principle, guideline and criterion', () => {
    expect(parseScTag('wcag111')).toBe('1.1.1');
    expect(parseScTag('wcag143')).toBe('1.4.3');
    expect(parseScTag('wcag412')).toBe('4.1.2');
  });

  it('reads two-digit criterion numbers without ambiguity', () => {
    // The case that breaks a naive split: this is 1.4.10, never 14.1.0.
    expect(parseScTag('wcag1410')).toBe('1.4.10');
    expect(parseScTag('wcag2411')).toBe('2.4.11');
    expect(parseScTag('wcag1412')).toBe('1.4.12');
  });

  it('rejects level tags and anything else', () => {
    for (const tag of ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag2a-obsolete', 'cat.forms', 'ACT']) {
      expect(parseScTag(tag), tag).toBeNull();
    }
  });
});

describe('isLevelTag', () => {
  it('recognises every level tag axe actually uses', () => {
    for (const tag of ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa']) {
      expect(isLevelTag(tag), tag).toBe(true);
    }
    expect(isLevelTag('wcag2a-obsolete')).toBe(true);
  });

  it('does not mistake a criterion tag for a level tag', () => {
    expect(isLevelTag('wcag111')).toBe(false);
  });
});

describe('compareScNumbers', () => {
  it('sorts in specification order, not lexicographic', () => {
    const sorted = ['1.4.10', '1.4.3', '2.4.11', '2.4.2'].sort(compareScNumbers);
    expect(sorted).toEqual(['1.4.3', '1.4.10', '2.4.2', '2.4.11']);
  });
});

describe('rule mapping', () => {
  it('attributes a rule to every in-scope criterion it claims', () => {
    expect(criteriaForAxeRule('image-alt')).toContain('1.1.1');
    expect(criteriaForAxeRule('color-contrast')).toContain('1.4.3');
    expect(criteriaForAxeRule('html-has-lang')).toContain('3.1.1');
  });

  it('returns nothing for an unknown rule id', () => {
    expect(criteriaForAxeRule('not-a-real-rule')).toEqual([]);
    expect(axeRule('not-a-real-rule')).toBeUndefined();
  });

  it('only ever names criteria we actually encode', () => {
    for (const rule of AXE_MAP.rules) {
      for (const sc of rule.sc) {
        expect(Object.hasOwn(CRITERIA, sc), `${rule.ruleId} -> ${sc}`).toBe(true);
      }
    }
  });

  it('indexes criterion to rules consistently with rule to criteria', () => {
    for (const rule of AXE_MAP.rules) {
      for (const sc of rule.sc) {
        expect(axeRulesForCriterion(sc).map((r) => r.ruleId)).toContain(rule.ruleId);
      }
    }
  });

  it('carries a Deque help URL for every mapped rule, for report deep links', () => {
    for (const rule of AXE_MAP.rules) {
      expect(rule.helpUrl, rule.ruleId).toMatch(/^https:\/\/dequeuniversity\.com\/rules\/axe\//);
    }
  });
});

describe('out-of-scope criteria', () => {
  it('is exactly the AAA criteria plus 4.1.1, which WCAG 2.2 removed', () => {
    expect([...outOfScopeAxeCriteria().keys()].sort()).toEqual([
      '1.4.6',
      '2.1.3',
      '2.2.4',
      '2.4.9',
      '3.2.5',
      '4.1.1',
    ]);
  });

  it('shows axe agreeing that 4.1.1 is obsolete', () => {
    // Independent corroboration from the tool's own metadata: axe tags the
    // duplicate-id rules `wcag2a-obsolete` precisely because 2.2 dropped 4.1.1.
    const rules = outOfScopeAxeCriteria().get('4.1.1') ?? [];
    expect(rules).toContain('duplicate-id');
    for (const ruleId of rules) {
      expect(axeRule(ruleId)?.tags, ruleId).toContain('wcag2a-obsolete');
    }
  });

  it('never lets an out-of-scope criterion leak into a rule\'s in-scope list', () => {
    for (const rule of AXE_MAP.rules) {
      for (const sc of rule.outOfScopeSc) {
        expect(rule.sc as readonly string[], rule.ruleId).not.toContain(sc);
      }
    }
  });
});

describe('what axe alone cannot reach', () => {
  it('covers 23 of the 55 criteria — the gap this project exists for', () => {
    expect(criteriaWithAxeCoverage()).toHaveLength(23);
    expect(criteriaWithoutAxeCoverage()).toHaveLength(32);
    expect(criteriaWithAxeCoverage().length + criteriaWithoutAxeCoverage().length).toBe(55);
  });

  it('leaves the criteria our heuristics and judgment layers are for', () => {
    const uncovered = new Set(criteriaWithoutAxeCoverage());

    // Keyboard behaviour, reflow, focus visibility: all need a real browser
    // driven through real interaction, which axe does not do.
    for (const sc of ['2.1.2', '1.4.10', '2.4.7', '2.4.11', '2.4.3'] as const) {
      expect(uncovered.has(sc), sc).toBe(true);
    }
  });

  it('does cover target size, which is easy to assume it misses', () => {
    // axe 4.12 ships `target-size` for 2.5.8. Worth asserting: an out-of-date
    // mental model of what a rule engine reaches is how tools end up
    // duplicating work or under-crediting the deterministic layer.
    expect(criteriaForAxeRule('target-size')).toContain('2.5.8');
  });
});

describe('hand-authored coverage agrees with axe', () => {
  const axeCheckIds = ALL_CRITERIA.flatMap((criterion) =>
    criterion.detectionCoverage
      .filter((coverage) => coverage.checkId.startsWith('axe.'))
      .map((coverage) => ({
        sc: criterion.num,
        checkId: coverage.checkId,
        attribution: coverage.attribution ?? 'tool',
      })),
  );

  it('names only real axe rule ids', () => {
    // Guards against a plausible-looking but invented rule name in the
    // hand-written detectionCoverage lists.
    const known = new Set(liveRules.map((r) => r.ruleId));
    for (const { checkId } of axeCheckIds) {
      expect(known.has(checkId.slice('axe.'.length)), checkId).toBe(true);
    }
  });

  it('backs every unmarked claim with axe\'s own tagging', () => {
    for (const { sc, checkId, attribution } of axeCheckIds) {
      if (attribution === 'handrail') continue;
      const ruleId = checkId.slice('axe.'.length);
      expect(criteriaForAxeRule(ruleId), `${checkId} claimed on ${sc}`).toContain(sc);
    }
  });

  it('keeps the handrail-attributed claims honest — and non-stale', () => {
    const marked = axeCheckIds.filter((c) => c.attribution === 'handrail');

    // There should be few of these, and each must genuinely go beyond axe. If
    // axe later adds the tag, this fails and the marker should be dropped —
    // which is what stops the annotations quietly becoming wrong.
    expect(marked.length).toBeGreaterThan(0);
    for (const { sc, checkId } of marked) {
      const ruleId = checkId.slice('axe.'.length);
      expect(criteriaForAxeRule(ruleId), `${checkId} on ${sc} is no longer beyond axe`).not.toContain(sc);
    }
  });
});
