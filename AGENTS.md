# AGENTS.md

Session-to-session memory for Handrail. **Read this and [`docs/PLAN.md`](docs/PLAN.md)
at the start of every session; update the three sections below at the end of every
session.** The plan is the roadmap of record. This file is where the plan meets
reality.

---

## Current state

**Phase 0 (bootstrap) is complete.** Nothing scans yet — there is no engine, no
CLI, no server. What exists is the contract layer, the toolchain, the CI gates,
and the fixture that Phase 1 will be measured against.

Landed:

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

**Phase 1 — engine + CLI.** Start with the freshness check (§0.1), then the
milestone's issues in order. The first three, roughly in dependency order:

1. `@handrail/wcag` — all 55 WCAG 2.2 A/AA criteria as typed records, plus the
   generated axe map with the CI stamp assertion.
2. `@handrail/engine` capture core — StateCapture and the element index. Everything
   downstream reads from these, so their shape matters more than their speed.
3. `@handrail/model` — the provider seam, with `local-deterministic` first so the
   eval backbone exists before anything depends on a network call.

Do the phase-start freshness check before writing code: re-verify pinned versions,
model ids, and prices, and record drift as an ADR plus a `docs/PLAN.md` amendment
in the same commit.

## Known gotchas

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
