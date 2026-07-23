import { CRITERIA } from './criteria-index.js';
import type { KnownScId } from './types.js';

/**
 * The shape of one entry from `axe.getRules()`.
 *
 * Declared structurally rather than imported from `axe-core`, because axe is a
 * **devDependency** here: the map is generated once and committed, so nothing at
 * runtime should pull a browser library into the dependency graph.
 */
export interface AxeRuleMetadata {
  ruleId: string;
  description: string;
  help: string;
  helpUrl: string;
  tags: readonly string[];
}

/**
 * axe encodes a success criterion as `wcag` + principle + guideline + criterion,
 * e.g. `wcag111` → 1.1.1, `wcag1410` → 1.4.10, `wcag2411` → 2.4.11.
 *
 * The first two digits are always single, and everything after them is the
 * criterion number — which is what makes `wcag1410` unambiguously 1.4.10 rather
 * than 14.1.0.
 */
const SC_TAG = /^wcag(\d)(\d)(\d+)$/;

/** Level tags: `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `wcag2a-obsolete`, … */
const LEVEL_TAG = /^wcag2[12]?a{1,3}(-obsolete)?$/;

/** Level tags that put a rule inside our A/AA target. */
const IN_TARGET_LEVEL_TAGS = new Set([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]);

/** Parses an axe SC tag into a criterion number, or null if it is not one. */
export function parseScTag(tag: string): string | null {
  const match = SC_TAG.exec(tag);
  if (match === null) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function isLevelTag(tag: string): boolean {
  return LEVEL_TAG.test(tag);
}

/** Sorts criterion numbers in specification order — 1.4.3 before 1.4.10. */
export function compareScNumbers(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface AxeRuleMapping {
  ruleId: string;
  /** Criteria from our 55 that this rule contributes to, in specification order. */
  sc: readonly KnownScId[];
  /**
   * Criteria axe tags that we deliberately do not cover — AAA criteria, and
   * 4.1.1 Parsing, which WCAG 2.2 removed. Recorded rather than dropped so the
   * gap is visible instead of implied.
   */
  outOfScopeSc: readonly string[];
  help: string;
  helpUrl: string;
  tags: readonly string[];
}

export interface AxeMapStamp {
  /** The axe-core version this map was generated from. CI asserts it still matches. */
  axeVersion: string;
  /** Total rules axe reported. */
  ruleCount: number;
  /** Rules contributing to at least one of our 55. */
  mappedRuleCount: number;
  /** Criteria in our 55 with at least one axe rule. */
  criteriaWithAxeCoverage: number;
}

export interface AxeMap {
  stamp: AxeMapStamp;
  rules: readonly AxeRuleMapping[];
}

/**
 * A rule that claims a WCAG A/AA level but maps to none of our 55 criteria.
 *
 * This is the condition the CI stamp check exists to catch. An axe upgrade that
 * adds a rule for a criterion we have not encoded would otherwise pass silently,
 * and the coverage matrix would under-report without anything failing.
 */
export function findUnmappedRules(rules: readonly AxeRuleMetadata[]): readonly string[] {
  return rules
    .filter((rule) => {
      const claimsTargetLevel = rule.tags.some((t) => IN_TARGET_LEVEL_TAGS.has(t));
      if (!claimsTargetLevel) return false;
      return !rule.tags.some((t) => {
        const sc = parseScTag(t);
        return sc !== null && Object.hasOwn(CRITERIA, sc);
      });
    })
    .map((rule) => rule.ruleId)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Builds the rule map from axe's own metadata.
 *
 * Deterministic by construction — rules sorted by id, criteria in specification
 * order — so regenerating produces a byte-identical file and CI can diff it.
 */
export function buildAxeMap(rules: readonly AxeRuleMetadata[], axeVersion: string): AxeMap {
  const mapped: AxeRuleMapping[] = [];
  const coveredCriteria = new Set<KnownScId>();

  for (const rule of rules) {
    const inScope: KnownScId[] = [];
    const outOfScope: string[] = [];

    for (const tag of rule.tags) {
      const sc = parseScTag(tag);
      if (sc === null) continue;
      if (Object.hasOwn(CRITERIA, sc)) {
        inScope.push(sc as KnownScId);
      } else {
        outOfScope.push(sc);
      }
    }

    if (inScope.length === 0 && outOfScope.length === 0) continue;

    inScope.sort(compareScNumbers);
    outOfScope.sort(compareScNumbers);
    for (const sc of inScope) coveredCriteria.add(sc);

    mapped.push({
      ruleId: rule.ruleId,
      sc: inScope,
      outOfScopeSc: outOfScope,
      help: rule.help,
      helpUrl: rule.helpUrl,
      tags: [...rule.tags].sort((a, b) => a.localeCompare(b)),
    });
  }

  mapped.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    stamp: {
      axeVersion,
      ruleCount: rules.length,
      mappedRuleCount: mapped.filter((r) => r.sc.length > 0).length,
      criteriaWithAxeCoverage: coveredCriteria.size,
    },
    rules: mapped,
  };
}
