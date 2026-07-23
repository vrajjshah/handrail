import { AXE_MAP } from './axe-map.generated.js';
import type { AxeRuleMapping } from './axe-mapping.js';
import { ALL_CRITERIA } from './criteria-index.js';
import type { KnownScId } from './types.js';

export { AXE_MAP } from './axe-map.generated.js';
export * from './axe-mapping.js';

const BY_RULE_ID = new Map(AXE_MAP.rules.map((r) => [r.ruleId, r]));

const BY_CRITERION = (() => {
  const index = new Map<KnownScId, AxeRuleMapping[]>();
  for (const rule of AXE_MAP.rules) {
    for (const sc of rule.sc) {
      const bucket = index.get(sc);
      if (bucket === undefined) index.set(sc, [rule]);
      else bucket.push(rule);
    }
  }
  return index;
})();

/** The axe rule metadata for one rule id, if axe has a WCAG mapping for it. */
export function axeRule(ruleId: string): AxeRuleMapping | undefined {
  return BY_RULE_ID.get(ruleId);
}

/**
 * The criteria an axe violation should be attributed to.
 *
 * Returns only criteria inside our A/AA target. A rule tagged solely with AAA
 * criteria (or with 4.1.1, which WCAG 2.2 removed) yields an empty array —
 * deliberately, so the engine does not attribute a finding to a criterion the
 * report does not track.
 */
export function criteriaForAxeRule(ruleId: string): readonly KnownScId[] {
  return BY_RULE_ID.get(ruleId)?.sc ?? [];
}

/** Every axe rule that contributes to a criterion. */
export function axeRulesForCriterion(sc: KnownScId): readonly AxeRuleMapping[] {
  return BY_CRITERION.get(sc) ?? [];
}

/** Criteria with at least one axe rule behind them. */
export function criteriaWithAxeCoverage(): readonly KnownScId[] {
  return ALL_CRITERIA.map((c) => c.num).filter((sc) => BY_CRITERION.has(sc));
}

/**
 * Criteria with **no** axe rule at all.
 *
 * This is the number behind the project's whole premise. Rule engines cover a
 * minority of WCAG; everything in this list needs a heuristic, a judgment call,
 * or a human, and a tool that quietly reports the rest as "passing" is the
 * problem Handrail exists to fix.
 */
export function criteriaWithoutAxeCoverage(): readonly KnownScId[] {
  return ALL_CRITERIA.map((c) => c.num).filter((sc) => !BY_CRITERION.has(sc));
}

/**
 * Criteria axe tags but we do not track, with the rules that reference them.
 *
 * All AAA, plus 4.1.1 Parsing — which axe itself marks `wcag2a-obsolete`,
 * independently confirming that WCAG 2.2 dropped it.
 */
export function outOfScopeAxeCriteria(): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const rule of AXE_MAP.rules) {
    for (const sc of rule.outOfScopeSc) {
      const bucket = index.get(sc);
      if (bucket === undefined) index.set(sc, [rule.ruleId]);
      else bucket.push(rule.ruleId);
    }
  }
  return index;
}
