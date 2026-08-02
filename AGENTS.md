# AGENTS.md

Session-to-session memory for Handrail. **Read this and [`docs/PLAN.md`](docs/PLAN.md)
at the start of every session; update the three sections below at the end of every
session.** The plan is the roadmap of record. This file is where the plan meets
reality.

---

## Current state

**Phase 1 complete — all 12 issues.** **Handrail scans a real site end to end and
writes an evidence report**, a golden snapshot guards the pipeline against drift,
and the hybrid path replays real recorded model responses in CI with no
credentials. Nothing in the tests or CI reaches a model provider.

**Phase 2 has started.** `docs/DESIGN.md` and `@handrail/tokens` are in (#14) —
the design system exists before the first component, which is what the plan
reserved that slot for.

Landed:

- **R2 artifact storage, and the hosted scan finally takes screenshots (#22).**
  Until this issue `runScanJob` passed no `ArtifactStore`, so `captureState`
  skipped screenshots entirely, the `artifacts` table had never held a row, and
  every hosted `report.html` was evidence-free. Now: a per-scan
  `ScanArtifactStore` writes content-addressed PNGs to a private R2 bucket under
  `artifacts/` and a catalog row beside them, and the hosted report inlines its
  evidence images as data URIs exactly as the CLI does. **`/api/artifacts/:id`
  stopped being a byte proxy and became a redirect issuer** — `302` to a
  five-minute presigned URL, `no-store`, clamped so a capability can never
  outlive the artifact. **Retention is the bucket's 14-day lifecycle rule, not
  ours**; the app's job is to agree with it, held by `expires_at` on every row,
  a `410 Gone` the moment it passes, and a credential-gated `pnpm test:r2` that
  reads the real lifecycle configuration and fails on divergence. Signed URLs
  are redacted from logs **by recognising `X-Amz-Signature` in the value**,
  the same by-type-not-by-key rule the Buffer scrub already used. CI needs no R2
  credentials and gained no job — everything else runs against an in-memory
  object store in the ordinary three-OS `unit` suite.
- **The deploy pipeline, and a live deployment (#21).** One Dockerfile on the
  Playwright base at the pinned tag, `SERVICE_ROLE` picking the role, compose
  parity verified by running a real scan inside the container, and
  **`https://handrail-production-34eb.up.railway.app` is live** — Postgres, the
  queue and Chromium all green, serving the SPA and the API from one image.
  Both halves of the acceptance were rehearsed against the live deployment;
  `docs/OPERATIONS.md` §5 has the transcripts.
- **Health and structured logging (#20).** `/healthz` is liveness and checks
  nothing else; `/readyz` proves Postgres *with its migrations applied*, the
  queue, and **a real Chromium launch** — verified against a running server:
  green with everything up, `503` with a broken Chromium while `/healthz` stays
  `200`. Every check runs even after one fails, a hung dependency is a failed
  one, and the Chromium result is cached on success only. pino JSON throughout,
  `correlationId` = the scan id on every line including Fastify's own, and
  screenshots redacted by *type* rather than by key name.
- **Abuse controls (#19) — the gate before the URL can be shared.** SSRF guard
  with a scheme allowlist, no-credentials rule, hostname blocklist, DNS resolve
  and a verdict on **every** returned address, and **redirects followed one hop
  at a time so each is judged before the next is taken**. All four named probes
  are refused with a test — `localhost`, `127.0.0.1`, `169.254.169.254`, and a
  public URL that 302s to the metadata endpoint — plus IPv4-mapped IPv6,
  octal-looking literals, NAT64, CGNAT and a name that resolves to one public
  *and* one private address. Drilled twice: removing the 169.254/16 block, and
  skipping the per-hop re-check. Sliding-window rate limit (3/hr/IP, global cap
  2) computed from the `scans` table so a restart is not a fresh allowance, a
  constant-time admin bypass that is off unless configured, hosted ceilings
  applied server-side, and a test asserting no evasion or CAPTCHA dependency
  exists.
- **The SSE stream with exact replay (#17).** `GET /api/scans/:id/events`, with
  `ScanEvent.seq` as the SSE event id, so "what have I seen" is a number the
  client hands back and "what am I owed" is a range query — no cursor, no
  window, no approximation. Killing a client mid-scan and reconnecting replays
  exactly the missed events, in order, tested **over a real socket** rather than
  `inject()`. Live delivery is Postgres `LISTEN`/`NOTIFY` with a slow poll
  underneath it as a floor; a 204 tells an `EventSource` to stop reconnecting to
  a scan that has already ended.
- **Persistence and the worker (#18).** Drizzle schema (scans, scan_events,
  findings, artifacts, eval_runs) with a **committed** migration applied as an
  explicit pre-start step, `PostgresScanStore` behind the same `ScanStore` port
  the API already used, and pg-boss embedded at concurrency 1. **#18's
  acceptance holds against a real Postgres**: a worker that dies mid-`detect` is
  picked up by a second one with fresh objects throughout, resumes from its
  LangGraph checkpoint, and **does not capture the page again** — drilled by
  forcing `resumed = false` and watching it go red. `seq` continues across the
  restart, so the resumed scan's event stream is one unbroken sequence, which is
  what #17 needs.
- `apps/server` — the Fastify API (#16). `POST /api/scans` (202), `GET
  /api/scans/:id`, `/report(.html|.sarif)`, `/api/artifacts/:id`, `/api/meta`
  with nearest-rank p50/p95, and `/openapi.json` **generated** from the same Zod
  contracts that validate the traffic. Plus SARIF 2.1.0 in the engine, where
  `likely` maps to `warning` and never `error`. A `ScanStore` port with an
  in-memory adapter is the seam #18's Postgres slots into. Making the OpenAPI
  real forced two genuine contract fixes — see gotchas.
- `apps/web` shell on React Aria Components (#15) — skip link, banner, named
  `Main` nav, `<main tabindex="-1">`, inverse footer, and a three-state
  System/Light/Dark theme control applied before first paint. **Handrail scans
  its own shell: 0 findings across desktop, mobile and reflow-320**, with
  `kbd.walk` (9 stops), `kbd.focus-visible` (9), `ptr.target-size` (11) and
  `resp.reflow-320` all pass-*verified*, not merely silent. Two real defects
  were found on the way, one by our own scanner and one only by tabbing — both
  in gotchas below.
- `@handrail/tokens` + `docs/DESIGN.md` (#14) — the design system as *measured*
  values. 44 colour-role pairs × 2 themes = **88 contrast pairs, all passing**,
  computed with the same WCAG relative-luminance arithmetic the engine applies to
  other people's sites. `theme.css` (Tailwind 4 `@theme`, both themes, the global
  focus ring, forced-colors and reduced-motion base rules) and three sections of
  `DESIGN.md` are **generated and committed**, with `generated.test.ts` failing on
  drift — drilled in both directions. DESIGN.md specifies the browser/viewport/
  zoom matrix, keyboard pattern per component, landmark and live-region rules,
  four screens, five state patterns and the copy rules. ADR-0006 records the
  Phase 2 freshness check.
- **Phase 1 audited against the plan's own acceptance, and two gaps closed** that
  the issue checkboxes had hidden: the CLI had never actually scanned a public
  site, and no recall baseline existed. Both done — see below.
- Recall baseline (`fixtures/golden/seeded-demo.recall.json`) — **7/14 (50%)**
  overall against the planted ground truth, **zero traps flagged**. Broken down
  by the layer meant to catch each defect: deterministic 2/3, heuristic 3/5,
  ai-text 2/3, **ai-vision 0/3** (the vision judge is Phase 3 and does not exist
  — reported as 0 rather than dropped from the denominator). Checked in CI, so a
  drop is a regression and a rise must still be recorded deliberately.
- `#69` fixed — grounding now resolves a cited name against `tag` / `text` /
  `role` / `accessibleName` as well as real attributes. The real model was being
  rejected for telling the truth: it cited `text = "Click here"` on an element
  whose snapshot text is exactly that. Recall on that page went 0 → 2 findings at
  `likely` (gt-006 and gt-013), verifier-confirmed.
- Cassette corpus recorded, closing #9 — the hybrid path now runs against a
  **real** Bedrock/Haiku response in CI with no API key. Recording immediately
  paid for itself: it exposed that Bedrock **rejects `output_config.format`**
  outright, so structured output there goes via a forced tool call with thinking
  disabled (measured against a live endpoint, encoded in the capability map). It
  also exposed a recall hole the synthetic backend could never show — see #69.

- Golden-scan snapshot (#13) — a full deterministic scan of the seeded-demo over
  a real browser, normalised and diffed against
  `fixtures/golden/seeded-demo.snapshot.json`. The only check that sees the whole
  pipeline at once. Drilled by swapping two nodes: it fails with a line-numbered
  diff naming the swapped phases. `golden-scan` is now a required status check.
  Re-record intended changes with
  `pnpm --filter @handrail/cli golden:scan --update` **in the same PR**, so the
  diff is reviewed next to the change that caused it.

- `apps/cli` + the report layer (#12) — `handrail scan <url>`, rendering the
  orchestrator's event stream as live progress. New `@handrail/engine` `report/`
  module: per-SC rollup (`fail > needs-review > pass > not-applicable >
  not-tested`), the coverage ledger, and a **self-contained** `report.html`
  (inline CSS, screenshots as `data:` URIs, bbox evidence overlays, source
  badges, cost footer). Verified live against the seeded-demo: 7 findings,
  schema-valid `report.json` with all 55 rollups, `$0.0000`, exit codes 0/1/2
  (clean / scanner-failed / findings-at-threshold) — keeping "your site has
  problems" distinct from "the scanner broke" is what makes it a usable CI gate.
- `@handrail/orchestrator` LangGraph graph (#11) — eight nodes (crawl, capture,
  detect, judge-text, verdict, site, score, report) over Zod state, run **once**
  with `streamMode: ['custom','values']`: the custom stream carries `ScanEvent`s
  while `values` yields the final state. `ScanEventEmitter` owns `seq` and is the
  only thing that does, and `checkEventStream` is exported so the CLI, the SSE
  endpoint and the golden scan can all assert well-orderedness rather than each
  re-deriving it. A `ScanDriver` interface keeps Playwright out of this package
  and lets the acceptance replay #10's committed seeded-demo capture browser-free
  on three OSes. `layering.test.ts` asserts no other workspace package depends on
  `@langchain/*`, drilled by faking a violation. Judges once per **URL**, not per
  state, and writes `hallucination-ledger.json` — both handed over by #10.
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

**Phase 2: #14–#22 are merged, #23–#26 are not.** Audited on 2026-07-26 against
the plan's own Phase 2 acceptance row and §Verification per phase — not the
issue checkboxes; #22 added on 2026-08-01.

**What the audit could verify, live, today** (a real server, real Postgres,
real Chromium, `https://example.com`):

- `POST /api/scans` → 202 → pg-boss → worker → **completed scan, report served**.
  The whole hosted path runs end to end locally.
- **429 on the fourth scan in an hour**, with `Retry-After: 3546` and a message
  that says "about 60 minutes".
- **SSRF probes rejected**: `localhost`, `127.0.0.1:5432`, `169.254.169.254`,
  `10.0.0.1`, `[::1]` — all 422, and the admin token bypasses the *rate limit*
  without bypassing the *guard*.
- **Worker restart mid-scan resumes** from its checkpoint without re-capturing
  (automated, against real Postgres).
- `/readyz` red on a broken Chromium while `/healthz` stays 200.

**What Phase 2's acceptance still needs, and which issue owns it:**

| Acceptance clause | State | Owner |
|---|---|---|
| Public URL | **live** — the shell and the API are deployed | #21 |
| Shareable evidence report | screenshots are captured, stored and served through signed expiring URLs; `report.html` inlines them. **Not yet rehearsed against the live deployment** — see below | #22 |
| Paste a site, watch it stream | **not started** — no scan screen | #23 |
| Scan survives restart | **done**, proven | #18 |
| SSRF attempts rejected | **done**, proven | #19 |
| Stats endpoint live | **live** at `/api/meta` | #21 |
| UI passes its own scan **in CI** | the scan passes (0 findings, 5 pass-verified); it is **not a gate** | #24 |
| Manual VoiceOver pass | **not started** — a human task | #26 |
| deploy.yml smoke + rollback rehearsed | **done** — both rehearsed live, OPERATIONS.md §5 | #21 |
| `docker compose up` full scan **on Windows** | compose works and runs a real scan on macOS; the Windows half is **backlogged, not blocking** | #88 |

**Three gaps worth knowing before picking up #23:**

1. **#22 has not been rehearsed against the live deployment.** The code path is
   covered end to end without credentials, and `pnpm test:r2` covers the bucket
   — but nobody has yet set the four `R2_*` service variables on Railway,
   watched `/readyz` report `object-storage`, run a real hosted scan and opened
   its `report.html` with images in it. Do that before #23 builds a report
   screen on top of it. OPERATIONS.md §8 is the runbook.
2. **`eval_runs` exists and is unused.** Deliberate — the table is cheap now and
   awkward to retrofit around live data. Phase 3 fills it.
3. **DNS rebinding is not covered** by the SSRF preflight (gotcha below). The
   fix belongs with the browser launch, and is still unowned now that #21 has
   shipped without it.

**Phase 1 is genuinely done** — audited against the plan's acceptance row and
§Verification per phase, not just the issue list. All twelve issues closed, three
public sites scanned into schema-valid reports, deterministic mode $0 offline,
golden snapshot and cassettes both running in CI with no API key, recall baseline
committed.

**Still open, deliberately:**

- **The `site` node is still a placeholder.** It emits a `log` and passes state
  through; site-level checks (consistent nav 3.2.3, multiple ways 2.4.5, …) are
  #45. `score` and `report` are real as of #12.
- **The graph is linear, and its channels are last-write-wins because of that.**
  When the crawler grows a `Send` fan-out (#46), the accumulating channels
  (`captures`, `findings`, `rejected`, `degradations`) need concat reducers and
  the emitter needs a writer per task instead of one mutable sink.

- **`kbd.focus-visible` accepts a ring drawn on a visually hidden element**
  (#74, found while building our own UI). Filed, unscheduled; needs a fixture
  first, per this repo's TDD.
- **`ai.lang-of-parts` and the two error families have no fixture.** They are
  implemented and re-checked but the seeded demo has no foreign-language passage
  and no error state, so their recall is untested. Phase 3's fixture corpus.

**Deferred (optional, from the plan's §Engine layer A):** IBM equal-access as a
ceiling-limited `secondOpinion`. Not built — it is marked optional, adds the heavy
`accessibility-checker` dep, and #5's acceptance did not need it. Pick it up if the
comparison scorecard wants a second rule engine.

## Known gotchas

- **The post-deploy smoke cannot prove #22, and was deliberately not extended
  to try.** `attachScreenshotEvidence` only attaches a screenshot to a finding
  that has a bbox, and the smoke scans the deployment's *own* landing page —
  which has **0 findings**, by #15's design. So a perfectly working R2 produces
  a smoke-passing report with no artifact references in it. Screenshots *are*
  still written (the capture puts them whatever the findings say), so the
  evidence is `select count(*) from artifacts` and a hand-run scan of a public
  site that actually has findings. Do not "fix" this by making the smoke assert
  an artifact id; it would fail on a healthy deployment.
- **A signed URL cannot live in a document meant to be kept.** `report.json`,
  the SARIF projection and every finding embed *artifact ids*, and those get
  attached to tickets and re-read next week. That is why `/api/artifacts/:id`
  survives as a stable unsigned path and *issues* a capability rather than
  *being* one, and why the hosted `report.html` still inlines its evidence as
  data URIs like the CLI does instead of linking to R2. Signed URLs are for the
  live UI (#23), which can always ask for a fresh one. Put one in a report and
  it is a broken image five minutes later.
- **A cache must never outlive the retention window.** The artifact route's
  `max-age` was a year with `immutable`, which was correct while nothing
  expired — content-addressed bytes really do not change. With a 14-day life it
  means a browser happily showing a screenshot the deployment has deleted, which
  is the privacy promise not being kept. `max-age` is now derived from
  `ARTIFACT_RETENTION_DAYS`. The `302` itself is `no-store` for the mirror-image
  reason: a cached redirect outlives the signature it points at, and the next
  visitor gets a 403 from a URL they have no way of seeing has expired.
- **A content-addressed upsert must move `expires_at` forward, never
  backwards.** The same bytes are produced by a retried worker, a second
  viewport, and a later scan of an unchanged page — each re-writing the object,
  which refreshes the *bucket's* lifecycle clock. `onConflictDoUpdate` therefore
  sets `greatest(artifacts.expires_at, excluded.expires_at)`. Last-write-wins
  would move it backwards and have the API refuse an artifact still sitting in
  the bucket. Drilled: swapping `greatest(...)` for `excluded.expires_at` turns
  `catalog.pg.test.ts` red.
- **Bytes first, catalog row second.** The other order leaves a row promising an
  object that does not exist, and a report full of 404s is worse than one that
  admits it has no evidence images. There is a test asserting a failed `put`
  records nothing.
- **R2 presigned URLs can only override a fixed set of response headers** —
  content-type, content-disposition, cache-control, content-encoding,
  content-language, expires. `x-content-type-options: nosniff` is **not** among
  them, so the artifact bytes are served without it. What makes that acceptable
  is that they come from `*.r2.cloudflarestorage.com`, a different origin from
  the app, and the `ContentType` is set accurately at upload. Do not describe
  the R2 response as carrying the proxy route's header set; it does not.
- **`GetObject` misses arrive as `NoSuchKey` *or* a bare 404.** A key that is
  absent raises `NoSuchKey`, but a bucket the credentials cannot list raises
  `NotFound` instead, and both mean the same thing to a caller. `isMissing`
  matches the class *and* `$metadata.httpStatusCode === 404`, or a missing
  screenshot surfaces as a 500.
- **`ArtifactReader.signedUrl` is required and may return `undefined` — that is
  deliberate.** Making it an optional *method* would put a capability check at
  every call site and one of them would forget. Every implementation answers the
  question; the in-memory store answers "no", which is exactly the branch the
  route has to handle anyway, so the byte-serving path stays exercised by the
  default suite rather than only by whoever holds credentials.
- **`@aws-sdk/client-s3` was nearly free here, and that is a coincidence.**
  `@anthropic-ai/bedrock-sdk` already pulls the smithy core in, so adding the S3
  client and the presigner added 22 packages rather than a hundred. If the
  Bedrock provider is ever dropped, re-measure before assuming S3 is still cheap.
- **Railway's builder rejects an unprefixed BuildKit cache-mount id.**
  `--mount=type=cache,id=pnpm-store` fails with "missing the cacheKey prefix
  from its id". The mount was removed rather than prefixed: a Dockerfile that
  only builds on one platform is not the portable artifact it exists to be, and
  layer caching already covers the common case.
- **The Playwright base image ships a newer Node than the repo pins.** v24 at
  the time of writing, against `.node-version`'s 22.23.1 — so the container
  would run a different major than CI tested. The image installs Node from the
  pin file (checksum-verified, `.tar.gz` because the base has no `xz-utils`),
  which means the two cannot drift.
- **`prepare: lefthook install` fails in a container**, because there is no git
  checkout, and it takes `pnpm install` down with it. The script now tolerates
  that and says why.
- **Fastify allows exactly one not-found handler per prefix.** The SPA fallback
  cannot register its own; `registerWebRoutes` returns whether it is serving and
  `app.ts` owns the single handler. `@fastify/static` uses `wildcard: false` so
  it registers a route per file and cannot shadow `/api`.
- **Gate the platform healthcheck on `/readyz`, not `/healthz`.** Rehearsed
  live: a container that could not launch Chromium stayed `DEPLOYING`, went
  `FAILED`, and never took traffic — the previous version served throughout. A
  liveness-only gate would have promoted it.
- **A green `/readyz` does not mean the demo works — and neither does a
  completed scan.** Rehearsed live twice. With `SERVICE_ROLE=api` every probe
  returned 200 and no scan finished, because nothing consumed the queue. Then
  with a worker regression that never saved the report, every probe returned 200
  **and the scan reported `completed`** — only fetching the artifact caught it
  (409). That is why the smoke validates the *report* rather than the status.
  OPERATIONS.md §5 has both transcripts.
- **An event emitted from inside a node that then throws may never be
  delivered.** `phase.failed` was written to the node's stream writer
  immediately before the node rethrew, and whether LangGraph flushes that chunk
  before propagating the error is a race — the `seq` is spent either way, so the
  stream ends up with a hole. It passed locally every time and failed in CI.
  Both `phase.failed` and `scan.failed` are now emitted in `streamScan`'s catch,
  on the path that yields directly. **Anything a node needs to say on its way
  out belongs outside the node.**
- **`formatters.log` runs over Fastify's own bindings and will flatten them.**
  A deep-copy that recurses into *every* object rebuilds it from its own
  enumerable properties — and Fastify's request keeps `method` and `url` on the
  prototype, so every request line came out as `req: {"id":"req-1"}` and every
  response as `res: {}`. An `Error` loses its stack the same way. The binary
  scrub now runs in `hooks.logMethod` (caller-supplied objects only) and only
  recurses into arrays and *plain* objects.
- **`correlationId` must be bound in `setChildLoggerFactory`, not an
  `onRequest` hook.** By the time a hook runs, Fastify has already written
  "incoming request" — and that line plus "request completed" are the two
  anyone greps for. The factory receives the *raw* request, so the scan id is
  read from the URL rather than from route params, which also covers every scan
  route without listing them.
- **Pass a pre-built pino as `loggerInstance`, not `logger`.** Fastify 5 keys
  its overloads on that: an instance under `logger` resolves the HTTP/2 overload
  and every route helper then fails to typecheck for reasons that mention
  `Http2SecureServer`. `createLogger` also returns `FastifyBaseLogger` rather
  than pino's `Logger`, or the narrower type propagates into every
  `register*Routes` signature.
- **The SSRF guard's preflight does not stop DNS rebinding, and says so.**
  `assertSafeUrl` resolves and judges every address at submit time and
  re-validates every redirect, which is what the acceptance asks for. It cannot
  stop a name that answers publicly then privately a second later, because the
  browser resolves again when it navigates. The real fix is pinning the
  validated address for the scan (Chromium's `--host-resolver-rules`), and it
  belongs with #21 where the browser is launched per scan. Do not describe the
  current guard as rebinding-proof.
- **Parse and judge an address with the same code, or the two will disagree.**
  `0177.0.0.1` is octal for 127.0.0.1 to some resolvers, and `::ffff:127.0.0.1`
  is loopback wearing a hat. `isIpLiteral` is built on the same parsers as
  `checkIp` precisely so "is this an address" and "is this address allowed"
  cannot answer differently. A separate regex for the first question is how
  these bypasses get in.
- **Check the rate limit *before* the SSRF guard.** Otherwise a rejected probe
  is free, and someone can walk the private range one 422 at a time. There is a
  test for the ordering.
- **Subscribe before reading the backlog, never after.** Between an SSE
  handler's backlog read and its subscription is exactly where an event is
  written and never delivered — and the client then waits forever for a scan
  that finished. The stream also needs its terminal check on *every* drain, not
  just the first: the terminal event arrives either live on a notification or
  already sitting in the backlog a reconnecting client was handed, and missing
  either leaves a socket that will never speak again. Both of those were real
  bugs here, caught by tests.
- **The SSE stream's own `seq <= lastSent` guard masks a wrong range query.**
  `events.test.ts` stays green if `eventsSince` replays one event too many,
  because the stream de-duplicates downstream. The boundary is asserted
  directly in `store.test.ts`; drilled by flipping `>` to `>=` and watching
  which file goes red. Same shape as the `selectorOf` escaping trap — when a
  defensive layer sits downstream of the thing under test, assert the property
  where it lives.
- **`reply.hijack()` is required before writing to `reply.raw`.** Without it
  Fastify sends its own response on top of the stream. And `NOTIFY` carries the
  scan id, never the event: a notification is a nudge answered by *reading*, so
  a dropped one costs latency rather than data. Postgres `NOTIFY` is explicitly
  not a queue.
- **`LISTEN` needs its own connection, never a pooled one.** A pooled
  connection goes back into rotation when its query finishes, so the
  subscription silently belongs to whoever borrows it next. `PostgresEventBus`
  holds a dedicated `Client` for listening and notifies through the pool.
- **`singletonKey` alone does not deduplicate in pg-boss 12.** Under the default
  `standard` queue policy it is simply recorded, so two `send`s of the same key
  both enqueue and you have deduplication you can describe but do not have. The
  queue is created with `policy: 'short'`, which is what makes at most one
  *waiting* job per key real. Caught by a test that asserted the second publish
  returns `null` — it did not.
- **pg-boss 12 has no default export.** `import PgBoss from 'pg-boss'` fails
  with TS2613; it is `import { PgBoss } from 'pg-boss'`. The batch handler's
  `jobs` parameter also needs an explicit `Job<T>[]` annotation or it lands as
  implicit `any`.
- **Resuming a scan must continue `seq`, not restart it.** `ScanEventEmitter`
  takes a `startSeq` for this. `seq` is the SSE event id, so a resumed scan that
  began again at 0 would mint a second event 4 for one scan and tell a
  reconnecting client it had already seen events it never received. The
  `(scan_id, seq)` primary key is the backstop, and `appendEvents` uses
  `onConflictDoNothing` so a retried worker re-writing an event is harmless
  rather than a crash.
- **A node-level checkpoint retries the node that failed.** Resuming skips
  *completed* nodes; the one that threw runs again from the top. So a node must
  be safe to re-enter — `detect` re-running axe is fine, and anything that
  spends money or mutates the target would not be. Worth checking before adding
  a node.
- **`PostgresSaver.setup()` is DDL, so it belongs in `db:migrate`, not in the
  worker's boot path.** Two containers starting together would otherwise race
  each other through the same schema creation, and the loser's error looks like
  a real failure. Same reason Drizzle migrations are an explicit pre-start step
  and `drizzle-kit push` is used nowhere.
- **`*.pg.test.ts` is a separate config and an ubuntu-only CI job.**
  `pnpm test:pg` with `DATABASE_URL` set; each file `describe.skipIf`s itself
  without one, and `fileParallelism` is off because they truncate shared tables.
  Locally: `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=handrail -e
  POSTGRES_USER=handrail -e POSTGRES_DB=handrail postgres:17-alpine`.
- **`*.r2.test.ts` follows the same pattern and has *no* CI job at all.**
  `pnpm test:r2` with the four `R2_*` variables set. Postgres can be a service
  container; a Cloudflare bucket cannot, and CI holds no cloud credentials for
  the same reason it holds no model API key. Everything provable without a
  bucket is proved in `artifacts.test.ts` against `MemoryObjectStore` in the
  ordinary `unit` job. Do not add this suite to the required checks — it would
  block every PR forever, exactly like `eval-deterministic` would have.
  Run it by hand after touching the bucket, `ARTIFACT_RETENTION_DAYS`, or
  `R2ObjectStore`. It is also the only thing that can tell you the app and the
  bucket's lifecycle rule have parted company.
- **A `z.transform` or `z.preprocess` anywhere inside a response schema is a
  500, and a JSON Schema of `{}`.** `fastify-type-provider-zod` *encodes* the
  response (output → wire), and a unidirectional transform cannot be encoded:
  `ZodEncodeError: Encountered unidirectional transform`. Separately,
  `z.toJSONSchema` refuses transforms and `z.custom`, so the generated OpenAPI
  documents them as an empty object — **no error, no warning, just a spec that
  has stopped describing anything.** Both bit here. The fixes are the better
  contracts anyway: `FindingSchema`'s tier-downgrade invariant is now
  `.overwrite` (same behaviour, bidirectional), the heuristic source is a
  `z.templateLiteral` rather than `z.custom`, and `source`'s single-or-array
  normalisation is a `z.codec` with a real `encode`. `openapi.test.ts` asserts
  the report schema is >500 chars and names its fields, because that is the only
  way to notice the `{}`.
- **`kbd.focus-visible` cannot see that the focused element is invisible — our
  own UI proved it.** React Aria puts DOM focus on a *visually hidden* input for
  radios, checkboxes and switches and marks the rendered element with
  `data-focus-visible`. The global `:focus-visible` ring therefore landed on an
  element clipped to a 1px box: **no visible focus indicator on the theme
  control, and our own check passed it**, because the style delta on
  `document.activeElement` is real. Caught by tabbing through the page, which is
  why DESIGN.md §11 makes the manual walk a step and not a nicety. The app-side
  fix is a `[data-focus-visible]` rule in `apps/web/src/styles/app.css`. The
  engine-side gap — a focus target that is clipped, `visibility: hidden` or
  zero-area should not count as focus-visible evidence — is filed as its own
  issue.
- **`sr-only` plus a padding utility is a pointer target.** Tailwind's `sr-only`
  sets `padding: 0` alongside its 1px box, so an unconditional `px-4 py-2` on
  the skip link inflated the hidden element to 32×16 — and `ptr.target-size`
  flagged it as a real 2.5.8 violation the moment the stacked header put another
  target beside it. Put *every* visual style behind `focus:`, padding included.
  This one our own scanner caught, which is the loop working.
- **Contrast ratio cannot tell you two colours look alike.** It is a luminance
  relationship between a foreground and *its background*, so two foregrounds can
  each clear 4.5:1 against the page and measure **1.09:1 against each other** —
  which is exactly what the accent teal and the AI-badge violet did. The property
  that applies between two semantic colours is hue separation (`hueDistance`),
  and it is a *secondary* channel: every tier and source badge carries its word,
  so nothing in the UI depends on telling two hues apart. Do not "fix" a
  distinguishability problem by raising a contrast requirement; it measures
  something else.
- **`--color-border` is not decorative, on purpose.** The token set has no
  exempt colour: `border` is subtle but still clears 3:1, so there is no
  `requirement: 'decorative'` escape hatch for a value that failed. If a new
  pair is needed it goes in `REQUIRED_PAIRS` and gets measured — a combination
  used but not listed is the hole the list exists to close.
- **The focus ring's `outline-offset` is load-bearing, not decoration.** The
  offset puts the ring on the surface *behind* the control, which is why
  `focus-ring` only has to be measured against the four surfaces instead of
  against every button fill. Switching to `box-shadow` would also break
  forced-colors mode, where a focus indicator matters most; `css.test.ts`
  asserts the string `box-shadow` never appears.
- **An `interface` cannot be passed where a loose-object schema is expected.**
  Only a `type` alias gets an implicit index signature, so `SarifLog` is a type
  alias with a one-line eslint exemption — the alternative was a cast at the
  call site, which would have silenced real shape errors too. Note that
  `consistent-type-definitions` and `noImplicitAny`-style assignability pull in
  opposite directions here; the lint rule is the one that yields.
- **`apps/web` is the one package that deviates from `tsconfig.base`.** Vite
  owns resolution there, so it sets `module: preserve` + `moduleResolution:
  bundler` + `jsx: react-jsx`; `NodeNext` rejects the extensionless imports Vite
  expects and refuses the `.css` side-effect import outright. It is also **not**
  in `tsconfig.build.json` — its artifact is a Vite bundle, not a tsc `dist`, so
  CI runs `pnpm --filter @handrail/web build` as a separate step.
- **eslint-plugin-react-hooks: use `configs.flat[...]`, not `configs[...]`.**
  The top-level entries are still the eslintrc shape and hand ESLint 10 a
  `plugins` **array**, which it rejects with a migration message rather than a
  useful error. Also: `react-hooks/set-state-in-effect` correctly rejects
  reading `localStorage` into state from an effect — use a lazy `useState`
  initialiser, which is also one fewer frame of the wrong value.
- **A byte-exact comparison against a committed text file fails on Windows
  without `.gitattributes`.** The Windows runner checks out CRLF, so
  `readFile(theme.css) === renderThemeCss()` compares identical content and
  reports a mismatch. The repo now pins `* text=auto eol=lf`, which is the fix —
  normalising `\r\n` away inside the test instead would let a genuinely
  CRLF-committed file pass and then churn on the next `tokens:build`. This cost
  one red Windows job; every future generated artifact inherits the fix.
- **`theme.css` and three sections of `docs/DESIGN.md` are generated.**
  `pnpm --filter @handrail/tokens tokens:build` regenerates both;
  `generated.test.ts` fails when either has drifted. Per the "a test that imports
  a generator runs the generator" rule, that test imports paths from `paths.ts`,
  **never** from `scripts/build-tokens.ts` (which ends in `await main()`).
  Drilled in both directions.
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
- **Bedrock rejects `output_config.format` — structured output there is a forced
  tool call.** `output_config.format: Extra inputs are not permitted`, measured
  against a live endpoint (a compatibility table said otherwise; the endpoint is
  the authority). The seam offers the schema as a single tool, forces
  `tool_choice`, and disables thinking — which is what the capability map's
  `forcedToolChoiceRequiresThinkingDisabled` flag was always pointing at. The
  result arrives already decoded as `tool_use.input`, and is *still* validated:
  "the model called the tool" is not "the model filled it in correctly".
- **A synthetic model backend cannot tell you your prompt is broken.** #10's
  suite shows three findings at `likely` using scripted candidates that ground by
  construction. The first real recorded response raised three candidates and had
  **all three rejected at grounding** — 0 AI findings on that page (#69). Treat
  `local-deterministic` as proof the plumbing works and nothing more; only the
  cassette corpus speaks to whether the prompts actually work.
- **The golden scan serves the fixture on a *fixed* port (5179), and it must
  stay fixed.** The scanned URL is hashed into `pageStateId`, which is hashed
  into every finding id, so `listen(0)` churns the entire snapshot on every run —
  I hit exactly that. Normalising the port away would also erase those content
  hashes, and they are worth diffing: a finding id changing means its check or
  xpath changed. The normaliser also *replaces* volatile values rather than
  deleting the keys, so a field vanishing from the report still shows as a diff.
- **Provider SDK clients are constructed lazily, on first call — keep it that
  way.** `new Anthropic()` throws when `ANTHROPIC_API_KEY` is unset, and in
  `replay` mode the inner transport is never reached, so eager construction would
  demand a key for a run that is deliberately offline. Laziness is what makes "no
  credentials in CI" true rather than aspirational. `wrapTransport` exists for the
  same reason: a surface can layer cassettes around a provider without taking its
  own dependency on `@anthropic-ai/sdk` (the CLI does not have one — check before
  adding).
- **`CostLedger.observe()` is the seam between credentials and the event stream.**
  Whoever owns the credentials constructs the ledger (the CLI), but only the
  orchestrator may mint a `seq`, and it exists later. `observe()` lets it turn a
  recorded invocation into a `model.invoked` event without the model package ever
  learning what an event is. Don't "simplify" it back to a single `onInvocation`.
- **Streaming the graph and then invoking it runs the whole scan twice.**
  `graph.stream(..., {streamMode:'custom'})` yields only what nodes write to
  `config.writer`, *not* the final state — so reaching for `graph.invoke()`
  afterwards to get the state re-runs every node: two captures, two judge calls,
  double the money. Use `streamMode: ['custom','values']` and read the last
  `values` chunk. I wrote the two-run version first and caught it on review.
- **LangGraph's compiled graph type cannot be named from outside its package**
  (TS2883, "not portable"). `createScanGraph` therefore declares a narrow
  `CompiledScanGraph` return interface covering the one method we drive, with a
  single localised cast at the return. Don't try to re-export the inferred type.
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

pnpm test:pg       # needs DATABASE_URL. Its own ubuntu-only CI job.
pnpm test:r2       # needs the four R2_* variables. No CI job, on purpose.
pnpm test:browser  # needs Chromium and the built fixture. Ubuntu-only CI job.
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
6. **Screenshots are somebody else's personal data.** Private bucket, signed
   expiring URLs, 14 days, never in a log — and neither is the signed URL that
   fetches one. The plan's trust invariant 7; #22 is where it became real.
