# AGENTS.md

Session-to-session memory for Handrail. **Read this and [`docs/PLAN.md`](docs/PLAN.md)
at the start of every session; update the three sections below at the end of every
session.** The plan is the roadmap of record. This file is where the plan meets
reality.

---

## Current state

**Phase 0 complete. Phase 1 in progress** — 9 of 12 issues done. The engine can
capture, detect **and judge**; the model seam has real providers, but nothing in
the tests or CI reaches a network — every call goes through an injectable
transport.

Landed:

- `@handrail/engine` text judge + verdict pipeline (#10) — **the trust core.**
  One batched `text-judge` call per state over a compact, sanitised
  element-index extract (23 elements / ~860 tokens on the seeded demo, against a
  6K budget), covering nine closed claim families: link purpose, label quality,
  heading quality, heading outline, page title, error messages, error
  suggestions, lang of parts, alt-text triage. Then the four stages every
  candidate must survive: **grounding** (elemId must be in the index; quoted DOM
  fuzzy-matches the snapshot at ≥90% via bounded, anchor-seeded Levenshtein;
  cited attributes are re-read from the snapshot, and a claim resting on one the
  page does not carry is rejected) → **dedupe** on `(family, elemId)` →
  **verification** (a deterministic re-check per family, plus a separate
  fresh-context Haiku verifier answering a four-boolean rubric) → **the hard tier
  matrix**, via `tierCeilingFor()`. Rejections become
  `hallucination-ledger.json` rows and can never come back. gt-006, gt-013 *and*
  gt-003 land at `likely`; every fixture trap is refuted deterministically before
  a verifier is asked. ADR-0005 decides the ADR-0004 caching hole.
- `@handrail/model` record/replay cassettes (#9) — `MODEL_MODE=live|record|replay`
  wrapping the provider transport. Cassettes are keyed by
  `(role, promptVersion, inputDigest)` and store the **request as well as the
  response**, so `cassettes:refresh` re-issues exactly what was sent rather than
  approximating it, under a budget cap checked *before* each call. A replay miss is
  a loud `CassetteMissError`, never a fall-through to the network.
  `findStaleCassettes` / `findUncoveredRoles` surface prompt-version drift. The
  corpus itself is empty until #10 gives it a real prompt to record.
- `@handrail/model` Anthropic + Bedrock providers (#8) — one shared Messages-API
  implementation (`createMessagesClient`) that both `createAnthropicClient` and
  `createBedrockClient` wrap; the only differences are the transport and the
  `anthropic.` model-id prefix. Native structured outputs via `output_config.format`
  + `zodOutputFormat`, the `system` prefix carrying a cache breakpoint, thinking set
  from the capability map (explicit adaptive on Sonnet 5, omitted on Haiku 4.5), and
  SDK errors mapped to typed `ModelError`s by HTTP status. Same prompt runs against
  both providers → schema-valid output; cached-prefix reuse shows up as `cacheRead`
  in the ledger. `@anthropic-ai/sdk` 0.113.0, `@anthropic-ai/bedrock-sdk` 0.32.0
  (ADR-0004 pins; model ids/prices re-verified — no drift). 20 new tests.
- `@handrail/model` provider seam (#7) — the `CostLedger` *is* the seam every
  model call goes through: it times, prices and records a schema-valid
  `ModelInvocation` on success *and* failure, then re-throws a typed `ModelError`
  (trust invariant 1 — no silent fallback). Ships `local-deterministic` (the $0
  eval backbone; responders script text, structured and forced-failure outcomes),
  a fail-loud price table with the Sonnet-5 intro window, a per-model/provider
  capability map encoding the ADR-0004 constraints, and `degradationForModelError`
  mapping a failure to the scan's `model-unavailable` degradation. 102 unit tests.
  No providers yet (#8) and no cassettes (#9).
- `@handrail/engine` first four heuristics (#6) — `kbd.walk`,
  `kbd.focus-visible`, `ptr.target-size`, `resp.reflow-320`. One keyboard traversal
  (real Tab presses) drives both kbd checks; ptr and reflow are pure over the
  element index. Full exception ladders (target-size spacing/inline, reflow 320px
  gating). Catches gt-005/007/008/009; both target-size traps and the focus-ring
  trap correctly pass. Added `layout` to the capture for reflow.
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

**The orchestrator (#11)**: LangGraph 1.x, 8 nodes, `streamMode: "custom"`
emitting `ScanEvent`s, with `@langchain/*` confined to that package. It wires
`runTextJudgment` into the `judge-text` phase, turns `VerdictDegradation`s into
scan-level `Degradation`s (`degradationForModelError` is already there for the
model ones), and owns writing `hallucination-ledger.json` next to the report —
the engine builds the ledger, it does not choose where a scan's artifacts live.

**Still open from #10, deliberately:**

- **The cassette corpus is still empty.** #10 built the prompts and wired
  `CURRENT_PROMPT_VERSIONS` into `findStaleCassettes` / `findUncoveredRoles`
  (there is a test asserting both roles currently read as *uncovered*), but
  recording needs a real API key and a real target page, which belongs with the
  CLI (#12) rather than a unit-test slice. **#9's "full hybrid path green in CI"
  acceptance is therefore still outstanding** — the replay path is exercised, the
  corpus is not.
- **The text judge runs per page *state*, not per page.** Text content does not
  change with viewport, so judging `desktop`, `mobile` and `reflow-320`
  separately would triple the cost for identical answers. The orchestrator should
  judge one state per URL and reuse the verdict; the engine deliberately does not
  decide this.
- **`ai.lang-of-parts` and the two error families have no fixture.** They are
  implemented and re-checked but the seeded demo has no foreign-language passage
  and no error state, so their recall is untested. Phase 3's fixture corpus.

**Deferred (optional, from the plan's §Engine layer A):** IBM equal-access as a
ceiling-limited `secondOpinion`. Not built — it is marked optional, adds the heavy
`accessibility-checker` dep, and #5's acceptance did not need it. Pick it up if the
comparison scorecard wants a second rule engine.

## Known gotchas

- **`/\s*(x)\s*/g` over page content is a denial of service, not a slow regex.**
  The pattern is ambiguous on a whitespace run — the engine retries `\s*` from
  every position inside it — so it is quadratic: 1.6s for 60,000 spaces, and the
  DOM snapshot it runs over is attacker-controlled. CodeQL's `js/polynomial-redos`
  caught it in `normalizeMarkup`. The chain was *accidentally* safe because
  `\s+` collapsed runs first, which is worse than being unsafe: the guarantee
  lived in the ordering of two `.replace()` calls and nothing at the call site
  could see it. Use ` ?(x) ?` and keep every step linear on its own. Assume any
  new regex that touches captured HTML gets this scrutiny.
- **A test that imports a generator runs the generator.** The seeded-demo capture
  is committed so the acceptance suite can run browser-free on three OSes, and a
  `*.browser.test.ts` re-captures the live fixture to prove the frozen copy has
  not rotted. The guard imported the generator module for its helpers — and that
  module ends in `await main()`, so importing it **regenerated the file the guard
  was about to check**, and the guard passed unconditionally. The reusable
  helpers now live in `scripts/seeded-demo-fixture.ts`, which has no side
  effects. Verified by drill: corrupt the committed capture, watch the guard go
  red. Any "check the committed artifact" test needs that drill.
- **Neither Phase 1 Haiku prompt prompt-caches, and padding them to fix that is
  the wrong move.** Haiku 4.5's minimum cacheable prefix is 4096 tokens; the
  verifier's prefix is ~400 and the text judge's is ~2,750 even after the WCAG
  reference block. ADR-0004 flagged this for the verifier only — it is wider than
  that. [ADR-0005](docs/adr/0005-verifier-prompt-caching.md) has the arithmetic:
  padding the verifier is *strictly more expensive forever*, and padding the
  judge saves ~$0.02 per 10-page scan in exchange for 1,300 tokens of filler in a
  prompt whose precision is the product. `COST.md` will show 0 cache reads for
  both roles; that is correct, not a bug to fix in the report.
- **`data-gt` is not in the element index, on purpose.** It is a fixture
  convention and a scanner has no business knowing about it, so ground-truth ids
  are joined to captured elements **by xpath** through the committed
  `seeded-demo-anchors.json`. The eval harness (Phase 3) has to do the same;
  do not be tempted to collect `data-gt` in the capture to make matching easy.
- **A deterministic re-check must only *refute* what it can decide.** The
  re-checks return `confirmed | refuted | inconclusive`, and `refuted` deletes a
  candidate outright. That is safe for "this element is not a link" or "h2 follows
  h1, no level was skipped", and unsafe for anything shaped like "this link name
  is probably fine" — a re-check that guessed would quietly become the thing
  deciding what users see, with none of the evidence a decision needs. When in
  doubt it returns `inconclusive` and the verifier gets the last word.
- **Only the independent verifier can lift an AI claim to `likely`.** A
  deterministic re-check confirms the *premise* (the name really is "Click
  here"), not the judgment built on it, so `verificationFor` leaves a
  re-check-only candidate at `unverified` → `needs-review`. Reversing that would
  let one model call and one regex look like corroboration.
- **The verifier is independent structurally, not by instruction.** It is a
  separate call with its own system prefix whose user turn is rendered from the
  *snapshot*, never from the judge's output — it never sees the judge's
  reasoning, confidence, or the other candidates. Passing it the judge's
  rationale "for context" would turn corroboration into a second signature on the
  same sentence. Only the claim sentence crosses over, because a claim cannot be
  verified without being stated.
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
- **The exception ladders are load-bearing — and the fixture kept over-claiming.**
  Three seeded defects had to be corrected because the naive reading was wrong, all
  verified empirically before changing anything: gt-009 (18×18 target) *passes*
  2.5.8 via the spacing exception when isolated — axe agrees — so it was re-authored
  crowded against a full-size neighbour; the global `outline:none` removed focus
  from *every* control, so the fixture now models the realistic pattern (global
  reset + global `:focus-visible` replacement, with gt-005 alone defeating it); and
  the fixture images overflowed at 320px, so `img { max-width: 100% }` was added to
  leave only the seeded table. Each check now produces exactly one finding per
  seeded defect. Lesson: when a fixture assertion and a correct check disagree,
  measure before assuming the check is wrong.
- **Component dedupe is deferred.** A page-wide cause (one bad CSS rule) can fail
  many elements; each currently becomes its own finding. The plan's component
  dedupe (one finding with `pages[]`) is a verdict/site-level concern for later.
- **The keyboard traversal uses real Tab presses**, per the long-standing React
  synthetic-event caveat. It reads `document.activeElement` from the isolated world
  after each `page.keyboard.press('Tab')`, which also means `:focus-visible` styles
  are in force — exactly what `kbd.focus-visible` needs.
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
  default, since `max_tokens` caps thinking and response together. Consequently
  **`ModelRequest` has no temperature knob at all** — steering is prompt-only
  across every provider. Don't add one "just for Anthropic"; it will 400 on Sonnet.
- **Anthropic and Bedrock share one Messages implementation.** `anthropic` and
  `bedrock` differ only in the transport and the `anthropic.` model-id prefix;
  everything else (request building, response/error mapping, structured output) is
  `createMessagesClient` in `anthropic-messages.ts`. Bedrock prefixes the id on the
  way *out* but the ledger records the **canonical** id (`claude-sonnet-5`, not
  `anthropic.claude-sonnet-5`), so pricing and `capabilityFor` stay provider-agnostic
  and a new model only needs registering under its canonical id. Don't fork the impl.
- **`promptVersion` is part of the cassette key, so bumping a prompt does not
  replay a stale answer — it misses.** That is the safe failure, but it means a
  revised prompt silently has *zero* replay coverage until it is re-recorded, and a
  suite that covers nothing still passes. `findStaleCassettes` and
  `findUncoveredRoles` exist to make that visible; wire them into a check rather
  than trusting a green replay run.
- **The transport carries a `TransportContext`, not just wire params.** The cassette
  key needs `(role, promptVersion, inputDigest)` and none of those survive into
  `MessageCreateParamsNonStreaming`, so `MessagesTransport` takes a second argument.
  Cassettes also store the **request**, which is what makes `cassettes:refresh` a
  true re-record instead of a guess.
- **The provider transport is the only network boundary — keep it injectable.**
  Every provider takes a `transport?: MessagesTransport`; the real SDK client
  (`new Anthropic()` / `new AnthropicBedrockMantle()`) is constructed *only* inside
  the default transport, never in tests. This is what lets the whole provider run
  offline and is exactly where #9's cassettes plug in. Never call a provider in a
  test without injecting a transport.
- **`APIError.generate(status, body, msg, headers)` returns an `APIConnectionError`
  when `headers` is falsy** — it short-circuits on `if (!status || !headers)` before
  looking at the status. So a test that builds a fake 401/429 with `undefined`
  headers silently gets a *connection* error and your status→code mapping never runs.
  Pass `new Headers()`. Cost me one red test.
- **Thinking is capability-driven, and Haiku 4.5 must not get `{type:'disabled'}`.**
  Sonnet 5 gets an explicit `{type:'adaptive', display:'omitted'}` (never rely on the
  silent adaptive default); Haiku 4.5 has no adaptive mode, so the seam simply omits
  the `thinking` field. The `system` prefix always carries a cache breakpoint, but it
  only caches above the model's floor (Haiku 4096 / Sonnet 2048, in the capability
  map) — below it, `cacheRead` stays 0 and COST.md must reflect that measured reality.
- **The price and capability tables fail loud, on purpose.** `computeCostUsd`
  throws `UnknownModelPriceError` and `capabilityFor` throws
  `UnknownModelCapabilityError` for any non-deterministic model they don't know.
  So #8 must register each new model in **both** `pricing.ts` (`MODEL_PRICES`) and
  `capability.ts` (`MODEL_CAPABILITIES`) — otherwise a *successful* call throws
  after the tokens were already spent. A silent $0 would corrupt COST.md, which is
  the one thing this table exists to prevent; the throw is the honest failure.
- **`local-deterministic` is $0 by provider short-circuit, not by a price entry.**
  `computeCostUsd` returns 0 for `provider === 'local-deterministic'` before any
  table lookup, and the backend reports `model: 'local-deterministic'` regardless
  of which role-model it stands in for. A **structured** request to it needs a
  responder that returns `output`, or it raises `DeterministicConfigError` — a
  test-setup bug, deliberately *not* a `ModelError`, so never map it to a
  degradation. Output that doesn't parse *is* a `ModelError('schema-invalid')`,
  mirroring a real provider's native-structured-output guarantee.
- **AGENTS.md's inline issue numbers were off by one from GitHub and are now
  fixed.** The model seam was labelled `#6` but is GitHub **#7**; the verdict
  pipeline was `#9` but is **#10**. GitHub #6 is the (closed) heuristics issue.
  When citing an issue number here, cross-check `gh issue view` — the phase-order
  and GitHub numbering are not the same sequence.
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
- **`__test__/` is dropped from the build at any depth.** The exclude glob is
  `src/**/__test__/**`, not `src/__test__/**` — the narrow form only covered the
  top-level folder, so `src/capture/__test__/serve-fixture.ts` was quietly
  compiled into `dist`. The corollary: a helper imported by anything the build
  keeps **cannot live in a `__test__/` folder**, or restoring it to `dist` is the
  only way to keep that importer compiling. Put it next to its non-test consumer
  instead — `src/scripts/serve-fixture.ts` and `seeded-demo-fixture.ts` are both
  there because `capture-seeded-demo.ts` imports them.
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
