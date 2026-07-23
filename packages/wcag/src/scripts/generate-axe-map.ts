/**
 * Regenerates `src/axe-map.generated.ts` from the installed axe-core.
 *
 *     pnpm --filter @handrail/wcag axe-map
 *
 * The output is committed. `axe.test.ts` rebuilds it in memory and fails if the
 * committed file has drifted, so an axe upgrade that adds, removes or retags a
 * rule turns CI red instead of silently changing what we claim to cover.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import axe from 'axe-core';

import { buildAxeMap, findUnmappedRules, type AxeRuleMetadata } from '../axe-mapping.js';

const rules = axe.getRules() as unknown as AxeRuleMetadata[];
const map = buildAxeMap(rules, axe.version);
const unmapped = findUnmappedRules(rules);

if (unmapped.length > 0) {
  console.error(
    `\n${String(unmapped.length)} axe rule(s) claim a WCAG A/AA level but map to no criterion we encode:\n` +
      unmapped.map((id) => `  - ${id}`).join('\n') +
      '\n\nAdd the missing criteria to KnownScId in types.ts before regenerating.\n',
  );
  process.exit(1);
}

const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with: pnpm --filter @handrail/wcag axe-map
//
// Built from axe-core ${map.stamp.axeVersion} via axe.getRules(). The stamp below is
// asserted in axe.test.ts: if the installed axe version moves, or any rule's WCAG
// tagging changes, the test fails and this file must be regenerated deliberately.
`;

const body = `${header}
import type { AxeMap } from './axe-mapping.js';

export const AXE_MAP: AxeMap = ${JSON.stringify(map, null, 2)};
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'axe-map.generated.ts');
writeFileSync(outPath, body, 'utf8');

console.log(
  `axe-core ${map.stamp.axeVersion}: ${String(map.stamp.ruleCount)} rules, ` +
    `${String(map.stamp.mappedRuleCount)} mapped to ${String(map.stamp.criteriaWithAxeCoverage)} of 55 criteria`,
);
