# AGENTS.md

Session-to-session memory for Handrail. **Read this and [`docs/PLAN.md`](docs/PLAN.md)
at the start of every session; update the three sections below at the end of every
session.** The plan is the roadmap of record. This file is where the plan meets
reality.

---

## Current state

**Phase 0 complete. Phase 1 in progress** — 3 of 12 issues done. The engine can
now capture a page; nothing detects or reports yet.

Landed:

- `@handrail/engine` axe detection layer (#5) — runs axe in-page after the capture,
  maps results to Findings via `criteriaForAxeRule()`, keeps `incomplete`
  (needs-review) and `passes` (carried as positive evidence, not findings), and
  attaches deterministic pixel evidence for contrast. Catches gt-002/004/011 at
  violation tier.
- `@handrail/engine` capture core (#4) — StateCapture, the element index, screenshot
  artifacts with lazy sharp crops, and the applicability-signal derivation.

- `@handrail/wcag` — all 55 WCAG 2.2 A/AA criteria as typed records, with
  `coverageMatrix()` / `coverageSummary()` and per-criterion applicability
  detectors (#2), plus the generated axe rule map with its CI stamp check (#3).
  118 tests total.
- ADR-0004, the Phase 1 freshness check: no drift on models, prices or library
  pins, but it found a real hole in the plan's cost model (see gotchas).
- `@handrail/schemas` v1 — Finding, ScanTarget, ScanOptions, ScanRecord, ScanEvent,
  Report, ModelInvocation, in Zod 4. 63 unit tests.
- Workspace scaffold: pnpm, strict TypeScript, vitest 4, eslint 10 flat config,
  lefthook pre-commit.
- CI: `lint`, `typecheck`, `unit` (ubuntu + macos + windows), `build`, `audit`,
  plus CodeQL and weekly Dependabot.
- `fixtures/apps/seeded-demo` — 14 planted defects, 5 traps, `ground-truth.json`.
- ADR-0000 through ADR-0003.

Verified working: `pnpm install && pnpm test` green from a clean clone,
`pnpm build` emits `dist` with no test files, the fixture app builds and serves on
`:5178`, and the `gt-014` dialog genuinely traps a keyboard under real Tab presses.

## Next up

**Phase 1: the first four heuristics** — `kbd.walk`, `kbd.focus-visible`,
`ptr.target-size`, `resp.reflow-320`. The element index already carries
`tabIndex`, `focusable`, `bbox` and the outline styles they need, and the fixture
plants gt-005/007/008/009 for exactly these. This is where the project starts
catching what axe cannot — kbd.walk drives real Tab presses (recall React's
synthetic onBlur caveat), and reflow needs the 320px viewport.

Then:

1. `@handrail/model` (#6) — the provider seam, with `local-deterministic` first so
   the eval backbone exists before anything depends on a network call. Read the
   API-shape constraints in ADR-0004 before writing it.

**Deferred (optional, from the plan's §Engine layer A):** IBM equal-access as a
ceiling-limited `secondOpinion`. Not built — it is marked optional, adds the heavy
`accessibility-checker` dep, and #5's acceptance did not need it. Pick it up if the
comparison scorecard wants a second rule engine.

## Known gotchas

- **WCAG 2.2 is 31 Level A + 24 Level AA — not 30/25.** Carrying a WCAG 2.1
  reference forward gives the wrong split because **4.1.1 Parsing (Level A) was
  removed** and two of the six 2.2 additions (3.2.6, 3.3.7) are also Level A. The
  total lands on 55 either way, which is exactly what makes it easy to miss. This
  bit during authoring — the test caught it, not review.
- **Page content is untrusted input.** We point this tool at arbitrary URLs, so
  any string taken from the DOM — attribute values especially — must be escaped
  before it goes into a selector, a query, a prompt or a report. CodeQL caught
  incomplete escaping here once already (backslash-then-quote, in that order).
- **Beware tests that pass for the wrong reason.** `selectorOf` verifies every
  candidate with `resolvesUniquely` and falls back when it fails, so a *correct
  selector* is not evidence of *correct escaping* — the guard masks the bug. When
  a defensive layer sits downstream of the thing under test, assert the property
  that actually differs, then drill it by reverting the fix.
- **Browser-side code must be fully self-contained.** `fn.toString()` serialises
  only the function body, so a module-level constant referenced from inside it
  becomes a `ReferenceError` in the page. This bit once already — every lookup
  table in `element-index.browser.ts` lives *inside* the function for that reason.
- **The capture never touches the target page**, and there is a test asserting the
  serialised DOM is byte-identical before and after. The element index is collected
  from a CDP **isolated world**, which also solves the esbuild `__name` problem:
  the shim is defined in that world and never reaches the page. Do not "simplify"
  this to `page.evaluate` — that runs in the page's own realm.
- **Roles and accessible names come from Chromium's AX tree, not our code.** Two
  CDP calls (`DOM.getDocument` + `Accessibility.getFullAXTree`) joined by
  `backendNodeId` → xpath. Reimplementing accname would put us at odds with what a
  screen reader actually announces, which is the one thing this tool cannot afford.
- **Browser tests are a separate vitest config and an ubuntu-only CI job.**
  `pnpm test:browser`; files are `*.browser.test.ts` and excluded from the default
  `unit` run so it stays green on macOS and Windows. They need the fixture built
  first (`pnpm --filter @handrail/fixture-seeded-demo build`).
- **`erasableSyntaxOnly` forbids TypeScript parameter properties.** Write
  `constructor(x: T) { this.x = x; }`, not `constructor(private readonly x: T)`.
- **axe passes placeholder-only labels — the fixture's gt-003 blind spot.**
  Chromium computes an input's accessible name *from* its placeholder, so axe's
  `label` rule passes a placeholder-only field. It is still a real 3.3.2 failure
  (the label vanishes on input), just not a rule-engine-catchable one. gt-003's
  ground truth was corrected from `deterministic`/`axe.label`/`violation` to
  `ai-text`/`ai.label-quality`/`likely` to match reality, and a browser test locks
  in that axe does *not* report it. The axe-catchable seeded issues are gt-002,
  gt-004, gt-011 — three, not the four the issue assumed.
- **axe runs in the page; the capture must come first.** `runAxeDetection` injects
  the axe bundle into the page's own realm (a real mutation), so it has to run
  after `captureState` on the same load, or the element index would reflect a page
  axe had already touched. axe target selectors are resolved to xpaths in an
  isolated world and joined to the index there.
- **`page.evaluate` cannot even declare a `const f = () =>`.** Not just named
  functions — a const-arrow declaration inside an evaluate also hits `__name`. The
  axe runner's in-page block is written as one inline anonymous arrow chain for
  this reason; the group trimming happens in Node instead.
- **axe reaches only 23 of the 55 criteria** — measured from its own metadata, not
  cited. 32 have no axe rule at all. Do not assume a criterion is uncovered without
  checking: axe 4.12 does ship `target-size` for 2.5.8, which is easy to get wrong.
- **`detectionCoverage` must name real axe rule ids, and the test enforces it.**
  Authoring by memory produced seven invented names (`axe.table-headers`,
  `axe.list-structure`, `axe.interactive-role`, …) and four criteria axe does not
  tag. Check `axeRulesForCriterion(sc)` before adding an `axe.*` entry.
- **Going beyond axe's tagging is allowed but must be marked** `attribution:
  'handrail'`. The test fails an unmarked claim axe does not make *and* a marked
  claim axe does make, so the annotations cannot rot as axe evolves.
- **The axe map is generated and committed.** `pnpm --filter @handrail/wcag axe-map`
  regenerates it; `axe.test.ts` fails if the committed file has drifted from the
  installed axe. On an axe upgrade, regenerate deliberately and read the diff — that
  diff *is* the change in what Handrail claims to cover.
- **`@handrail/wcag` proves its own completeness at compile time.** The
  `MustEqual<DefinedScId, KnownScId>` line in `packages/wcag/src/index.ts` fails to
  typecheck if a criterion is missing *or* extra. Verified by drill in both
  directions, so trust it — but if you add a criterion, add it to `KnownScId` too
  or the build stops.
- **Applicability detectors lean to `unknown`, not `not-applicable`.** "No video on
  this site" is a claim about the whole site and is wrong the moment the crawler
  missed a page. Only genuinely certain absences (site-level criteria on a
  single-page scan) return `not-applicable`.
- **The verifier's ≤2K prompt cannot be prompt-cached on Haiku 4.5.** Its minimum
  cacheable prefix is 4096 tokens, so the cache silently never populates —
  `cache_creation_input_tokens` is just 0. Options are in
  [ADR-0004](docs/adr/0004-phase-1-freshness-check.md); decide it in the verifier
  issue and build COST.md from measured `cache_read_input_tokens`.
- **Sonnet 5 rejects `temperature`/`top_p`/`top_k` at non-default values**, has no
  `budget_tokens`, and runs adaptive thinking when `thinking` is omitted. The
  provider seam must set the thinking mode explicitly rather than relying on the
  default, since `max_tokens` caps thinking and response together.
- **Zod 4: `.default()` vs `.prefault()`.** `.default()` takes the schema's *output*
  type, so `.default({})` fails on any object whose fields have their own defaults.
  Use `.prefault({})` — it feeds the value through parsing so inner defaults apply.
  This will bite again on every new config object.
- **TypeScript is pinned to 6.0.3 on purpose.** `typescript-eslint@8.65` caps its
  peer range at `<6.1.0`, so TypeScript 7 breaks typed linting. `pnpm install` will
  keep advertising 7. See [ADR-0003](docs/adr/0003-toolchain-version-drift.md).
- **Branded ids need their constructors.** `ScanId`, `FindingId`, `ArtifactId` and
  friends are branded, so a bare string will not typecheck. Use `scanId(...)`,
  `findingId(...)`, `artifactId(...)` from `@handrail/schemas`.
- **Two tsconfig graphs.** `tsconfig.json` includes tests (typecheck + the eslint
  project service read it); `tsconfig.build.json` excludes them so nothing
  test-shaped reaches `dist`. A new package needs **both** files and an entry in
  **both** root configs, or it will silently drop out of typecheck.
- **`fixtures/**` is excluded from eslint** — `eslint-plugin-jsx-a11y` would flag
  most of the seeded app, which is the point. Do not "fix" anything in there; see
  its [README](fixtures/apps/seeded-demo/README.md).
- **React's synthetic `onBlur` is unreliable for focus-trap behaviour.** The
  fixture's trap intercepts `Tab` in `onKeyDown` instead. Worth remembering when
  Phase 1 writes `kbd.focus-trap`: verify against real key presses, not scripted
  `.focus()` calls, because the two behave differently.
- **Node is managed by fnm on the build machine.** `.node-version` pins 22.23.1 and
  `~/.zshrc` has `fnm env --use-on-cd`, so a new shell in this directory gets the
  right Node automatically. A shell that does not source the profile will not.
- **The unscoped npm name `handrail` is already taken** — it is an unrelated
  functional-programming utility at `handrail@2.0.0` (github.com/brekk/handrail).
  The `@handrail` *scope* appears free. So `npx handrail scan <url>` as written in
  the plan will not work as-is, and the CLI needs either a scoped package with a
  `handrail` bin, or a different published name. Decided in Phase 5, not before;
  tracked as an issue on that milestone.
- **Branch protection does not yet require `eval-deterministic` and `golden-scan`.**
  Plan step 10 lists them, but neither check exists before Phase 1/3, and requiring
  a check that never reports blocks every PR forever. Add each to the required set
  in the same PR that first makes it run.

---

## How to work this repo

Full rules are in [`docs/PLAN.md`](docs/PLAN.md) §0.1. The short version:

- **One session, one issue.** Pick an issue from the current phase milestone, do it,
  commit in conventional-commit slices referencing the issue, update this file,
  stop. A fresh context per slice beats one exhausted mega-session.
- **Branch → PR → squash merge**, always. PRs exist for the checks and for the
  public history, not for ceremony; self-merge is expected.
- **Fixture-first is this project's TDD.** For every new check, author the fixture
  page and its expected ground truth *before* the implementation. The failing eval
  is the failing test. Pure logic — schema refinements, scoring, the SSRF guard,
  cost math — gets colocated vitest tests written alongside the code.
- **Never re-litigate a locked decision** mid-session. If reality has moved, write
  an ADR and amend `docs/PLAN.md` in the same commit. Amend the plan; never rebuild
  it.
- **Leaf decisions are made in the phase that builds them**, not early. If you find
  a deferred decision with no reserved slot, open an issue for it rather than
  deciding it inline.

## Commands

```bash
pnpm install
pnpm test          # vitest, all packages
pnpm typecheck     # tsc --build across the workspace
pnpm lint          # eslint 10, typed rules
pnpm build         # emits dist/, excludes tests
pnpm --filter @handrail/fixture-seeded-demo dev   # the seeded app on :5178
```

## Non-negotiables

These are the trust invariants from `docs/PLAN.md`. They are the product; a change
that weakens one needs an ADR, not a commit message.

1. **No silent model fallback.** A scan that could not reach its model is
   `degraded` and says so in the report.
2. **No unevidenced AI finding above `needs-review`.** Enforced in the schema, not
   by convention.
3. **Tier ceilings by provenance.** Deterministic evidence ⇒ `violation`; AI plus
   an independent verifier ⇒ `likely` at most; anything unclear ⇒ `needs-review`.
4. **Honest coverage.** Untested criteria are listed, never hidden. No number out
   of 100 presented as an accessibility score.
5. **The glass house.** Handrail's own UI passes Handrail's own scan in CI.
