# @handrail/wcag

All **55 WCAG 2.2 Level A and AA success criteria** as typed records, plus the
generated axe-core rule map. This package is where Handrail's coverage claims
come from, so its job is to be *right* rather than merely useful.

```ts
import { CRITERIA, coverageSummary, criteriaForAxeRule } from '@handrail/wcag';

CRITERIA['1.4.10'].userImpact;      // why reflow matters, in report prose
coverageSummary('AA').uncovered;    // the criteria we do not automate — listed, never hidden
criteriaForAxeRule('color-contrast'); // ['1.4.3']
```

## The counts

| | |
|---|---|
| Criteria at A / AA | **31 / 24** (55 total) |
| Covered by at least one axe rule | **23** |
| No axe coverage at all | **32** |
| No automated coverage of any kind | **7** |
| Human-only however good the tooling gets | **7** |

axe-core is the best rule engine there is and it reaches 23 of 55 criteria. That
gap is the entire premise of this project, and it is measured here from axe's own
metadata rather than asserted.

## Two traps this package exists to avoid

**WCAG 2.2 is 31 A + 24 AA, not 30 + 25.** Carry a WCAG 2.1 reference forward and
you get the wrong split, because **4.1.1 Parsing (Level A) was removed** and two of
the six 2.2 additions (3.2.6, 3.3.7) are also Level A. The total lands on 55 either
way, which is what makes it easy to miss — and every "X of 55" percentage in a
report divides by it. axe agrees, incidentally: it tags its `duplicate-id` rules
`wcag2a-obsolete` for exactly this reason.

**Absence of findings is not a pass.** Each criterion carries two separate fields:
`testability` (how decidable the criterion is *in principle*) and
`detectionCoverage` (what our checks can actually conclude). Only a `decides`-class
check can justify reporting a criterion as `pass`, because a failure-detector's
silence proves nothing.

## Regenerating the axe map

`src/axe-map.generated.ts` is committed and generated from the installed axe-core:

```bash
pnpm --filter @handrail/wcag axe-map
```

`axe.test.ts` rebuilds the map in memory and compares it to the committed file, so
an axe upgrade that adds, removes or retags a rule **fails CI** rather than quietly
changing what we claim to cover. It also fails if any rule claiming a WCAG A/AA
level maps to no criterion we encode. When that happens, the fix is to encode the
missing criterion — not to regenerate past the warning.

Both guards are drill-tested: bumping the stamped version and blanking a rule's
criteria each turn the suite red.

## Attribution

`detectionCoverage` entries default to `attribution: 'tool'`, meaning axe itself
tags the rule with that criterion — a claim checkable against axe's metadata.
A few are marked `'handrail'`, meaning we attribute further than axe does. For
example axe tags its `label` rule only 4.1.2, but a form field with no label is the
textbook 3.3.2 failure (WCAG failure technique F68).

The test enforces this in **both** directions: an unmarked claim axe does not make
fails, and a marked claim axe *does* make fails too. So the annotations cannot rot
as axe evolves, and a report can always say which claims are the tool's and which
are ours.

## Applicability

`applicabilityFor(signals)` runs each criterion's detector against structural facts
the engine computed. Detectors return `unknown` rather than `not-applicable`
whenever absence might just mean we did not look hard enough — "this site has no
video" is a claim about the whole site, and it is wrong the moment the crawler
missed a page. Only genuinely certain absences, like site-level criteria on a
single-page scan, return `not-applicable`.

`ApplicabilitySignals` is also the seam that keeps the layering rule intact: the
engine computes the signals, this package decides applicability, and
`@handrail/wcag` never imports the engine.
