# Handrail — the Open-Source AI Accessibility Engineer (v2 plan: personal repo from day 1)

> **This document is self-contained.** It embeds all market research conclusions, every locked decision, the architecture, phases, budgets, and risks. A fresh Claude Code session that reads only this file can start Phase 0 immediately — no re-research needed.

## Amendments to the source plan

This file is the plan as authored, transcribed into the repo on 2026-07-23 as the roadmap of record.
Per §0.1 ("if reality contradicts the plan … amend `docs/PLAN.md` in the same commit"), the following
points differ from the source document. Everything else is verbatim.

- **[†1] Repo path is `~/Projects/handrail`, not `~/dev/handrail`.** `~/dev` does not exist on the build
  MacBook; the owner's other public portfolio repos (`agentforge`, `clinical-copilot`, `steward`) all live
  under `~/Projects`. Read every `~/dev/handrail` in §0 and the Locked-decisions table as `~/Projects/handrail`.
- **[†2] The Hosting row's `SERVICE_ROLE` value was reconstructed.** The source document's markdown table
  cell contained unescaped `|` characters inside a code span, so the renderer truncated the cell after
  `` `SERVICE_ROLE=api ``. The value is restored here as `api|worker|both` (consistent with the
  single-Dockerfile + embedded-pg-boss-worker design described under §Hosted showcase), with the pipes
  escaped. If the original cell said anything more, it is lost and should be re-added here.
- **Phase 0 environment note.** The MacBook had no Node toolchain at all. Installed during this session:
  `fnm` (Homebrew) → Node v22.23.1 → `corepack enable` → pnpm 11.16.0; `eval "$(fnm env --use-on-cd)"`
  added to `~/.zshrc`.

## §0 Kickoff on the MacBook (build machine)

This plan was authored on the HCL Windows laptop (which keeps only the frozen spike — never build there). To start on the personal MacBook:

1. **Transfer this file** to the Mac (email to self / cloud drive / USB — any way). Save as `~/dev/handrail-plan.md`.
2. On the Mac: install prerequisites if missing — Node ≥22.12 (`brew install fnm` or nvm), `corepack enable` for pnpm, `gh` CLI logged into the **personal** GitHub account, Claude Code.
3. `mkdir -p ~/dev/handrail && cd ~/dev/handrail`, start `claude`, and paste this kickoff prompt:
   > Read ~/dev/handrail-plan.md — it is the complete, decided plan for this project (all research and decisions are final; do not re-research or re-litigate them). Execute "First implementation session (Phase 0)" exactly as written, committing in conventional-commit slices. Copy the plan into the repo as docs/PLAN.md as step 0.
4. From then on, `docs/PLAN.md` in the repo is the roadmap of record; future sessions on any machine read it from the repo.

## §0.1 Session playbook (how to work this plan without losing context)

The source of truth is **files in the repo, never the conversation**. Rules for every session:

- **One session = one slice/issue (~2–4h).** Start by reading `docs/PLAN.md` + `AGENTS.md`; end with conventional commit(s) + an `AGENTS.md` update (what's done, what's next, gotchas). Then quit. Fresh context per slice beats one exhausted mega-session; auto-compaction can blur details, files can't.
- **Issues as stories:** during Phase 0, create a GitHub milestone per phase and ~5–10 issues per phase from the roadmap tables below (via `gh issue create`). Each later session picks one issue, references it in the commit, closes it when the acceptance criterion is met. The public milestone/issue history doubles as portfolio evidence.
- **Sequential by default.** Phase 0 is strictly sequential. From Phase 1 onward, parallel sessions are allowed only on independent packages (e.g., `@handrail/wcag` data vs `engine/capture` vs CLI) using git worktrees — use sparingly; solo review bandwidth is the real constraint. Good parallel candidates: eval-fixture authoring (Phase 3), WCAG SC data entry (Phase 1).
- **Never re-litigate locked decisions** (§Locked decisions) mid-session; if reality contradicts the plan (API changed, price moved), write/update an ADR and amend `docs/PLAN.md` in the same commit.
- **AGENTS.md is the session-to-session memory.** Keep a "Current state / Next up / Known gotchas" section at the top, updated every session.
- **Phase-start freshness check (~15 min).** This plan is a July 2026 snapshot. At each phase boundary, verify the phase's pinned library versions, model IDs, and pricing against current docs (npm, Anthropic docs); record any drift as an ADR + a `docs/PLAN.md` amendment in the same commit. Never rebuild the plan from scratch over drift — amend it.
- **Decide just-in-time.** Only reversal-expensive decisions are pre-made (§Locked decisions, contracts, trust invariants, quality mechanisms). Leaf decisions — visual identity, per-surface config details (e.g. MCP key handling), copy — are made in the phase that builds them, guided by the standards files, and each has a reserved slot (DESIGN.md slice, a phase issue). Don't decide them early (they go stale) and don't skip their slot (that's how quality drops). If a session finds a deferred decision with no slot, create the issue — don't decide it inline.

## Context

The spike in `C:\HCL\App Builder` (LangGraph vs Mastra on a WCAG review→fix→verify workflow) is complete: mechanical 84–84 tie, conclusion "workflow design matters more than framework branding." The owner is now building **Handrail** — an ambitious open-source accessibility platform: deterministic scanners + programmatic heuristics + LLM/vision judgment + evidence-first reporting + verified fixes, delivered as web UI, CLI, CI action, and MCP server.

**Ownership decision (user-confirmed):** Handrail is built in a **personal GitHub repo from day 1, MIT-licensed from day 1, developed on the user's personal laptop** on personal time. The HCL repo/machine stays untouched as the internal spike record; product code is **written fresh (port-by-rewrite)** using the spike as reference — no copying of enterprise-repo code — keeping IP clean for an OSS launch (Show HN) and a future business. HCL still benefits as a *user* of Handrail (Bedrock provider support, internal target profiles, self-hosted deployment). User is a **US green-card holder → no immigration restrictions on side work**; paid freelance/consulting/business are all open. Single remaining checkbox: skim the HCL employment agreement's moonlighting/IP clause (standard for any employee).

**Strategic sequencing:** while job-hunting, this project's primary job is reputation → US job (portfolio, HCL-internal visibility as a user story, Show HN launch with a published eval scorecard). Because the green card removes work restrictions, **paid side consulting is viable immediately** — the free scan report is the natural lead magnet for "hire me to remediate" projects (EAA fines since June 2025, ADA Title II 2026–2028 deadlines drive demand). Product-as-business (hosted tier) remains a later option once traction exists.

**Market opening (researched July 2026):** rule engines (axe-core, Pa11y, Lighthouse, WAVE, IBM Equal Access) catch ~30–57% of WCAG issues; the AI tools that close the gap (Deque axe DevTools AI, Evinced, GitHub's Copilot-cloud scanner, WCAG-Scanner SaaS) are all closed-source; OSS has only thin MCP wrappers. Nobody in OSS ships: keyboard-simulation heuristics, vision judgment (e.g., alt text that *lies* about the image — flagged by comparing pixels vs claim), honest per-SC coverage, verified fix loops, or published precision/recall. That's the product.

## Locked decisions

| Decision | Choice |
|---|---|
| Repo | **New personal repo `github.com/<personal>/handrail`, public, MIT from first commit — developed on the personal laptop** (e.g. `~/dev/handrail` there; this HCL machine keeps only the spike). HCL repo receives no product code; later consumes published npm packages / Docker image with HCL-specific profiles kept on the HCL side. |
| Framework | **LangGraph 1.x** — fresh merit decision (user said ignore spike tie-break): we build our own Fastify server + Vite SPA (neutralizes Mastra's app-framework edge); LangGraph wins on Postgres checkpointing riding our DB, `interrupt()` human gates, `Send` fan-out, custom stream events → SSE, ecosystem/portfolio weight. Recorded in ADR-0001. |
| Name | **Handrail** — `@handrail/*` packages, `handrail` CLI (`npx handrail scan <url>`). Verify npm scope at first publish (fallback `@handrail-a11y`). |
| Hosting | **Railway** — single Dockerfile (Playwright base image), managed Postgres, ~$5–15/mo; `SERVICE_ROLE=api\|worker\|both` selects the process role from one image. [†2] |
| Server stack | Fastify 5 + `fastify-type-provider-zod` (auto-OpenAPI), pg-boss (queue in Postgres, no Redis), Drizzle, SSE with Last-Event-ID replay, React 19 + Vite SPA + Tailwind 4 + TanStack Query. |
| Tests | vitest ^3; custom eval harness as CI gate. |
| Runtime | Node `>=22.12`; tsx as runtime through Phase 2 (ADR-0002); Zod 4 from the start (new repo, no legacy); Playwright pinned to its Docker base tag. |
| Models | `@handrail/model` provider seam built on **official SDKs**: `anthropic` (`@anthropic-ai/sdk` — **native structured outputs** via `output_config.format` + `zodOutputFormat` = guaranteed schema-valid JSON, image blocks, typed errors), `bedrock` (`@anthropic-ai/bedrock-sdk` Mantle client, `anthropic.`-prefixed model IDs — HCL/enterprise), `openai`, `local-deterministic` (eval backbone, $0). Per-role (verified 2026-07): `claude-haiku-4-5` ($1/$5 MTok) triage/text/verify; **`claude-sonnet-5`** ($3/$15; intro $2/$10 through 2026-08-31) vision/fix — near-Opus agentic quality, high-res vision 2576px. IDs config-swappable; Sonnet 5's tokenizer yields ~30% more text tokens than 4.x — size budgets against it. **Prompt-cache the stable prefix** (system prompt + WCAG reference) across per-page judgment calls (~90% cached-input savings within a scan burst). BYOK for users; hosted demo uses own key behind hard limits. |

**Spike pitfalls to not repeat (fresh-code guardrails):** no silent deterministic fallback on provider failure (throw typed error, mark scan `degraded`); no `pnpm.cmd`-style platform hardcodes (execa); don't discard axe `incomplete` results (they feed needs-review); no brittle model-capability regexes (capability map per provider).

## New repo layout

```
handrail/
  apps/      web/  server/  cli/  action/(P4)  mcp/(P5)
  packages/  schemas/ wcag/ model/ prompts/ engine/ orchestrator/ evals/
  fixtures/  apps/seeded-demo/   apps/clean-control/   wcag/<checkId>/<case>/   pages/adversarial-injection.html
  docs/      adr/  ARCHITECTURE.md USERS.md EVALS.md THREAT_MODEL.md COST.md OPERATIONS.md DEMO.md ROADMAP.md
  .github/workflows/  ci.yml  eval-ai.yml  deploy.yml  release.yml(P5)
  Dockerfile  docker-compose.yml  LICENSE(MIT)  README.md  AGENTS.md  CONTRIBUTING.md(P5)  SECURITY.md(P5)
```

Port-by-rewrite map (spike → Handrail, reference-only):

| Spike concept | Handrail home | Notes |
|---|---|---|
| shared-schemas Zod contracts | `@handrail/schemas` | Redesigned: unified FindingSchema (see below), Scan/Event/Report new |
| evaluator-tools capture/journey/auto-explore/screenshots | `@handrail/engine` `capture/` `crawl/` | Rewritten with StateCapture + element index |
| model-runtime provider seam | `@handrail/model` | Rewritten; adds anthropic-messages, per-role models, cost ledger, strict errors |
| wcag-reference (9 SC / 3 mappings) | `@handrail/wcag` | Expanded to all 55 WCAG 2.2 A+AA SC + generated axe map |
| runner-langgraph graph shape | `@handrail/orchestrator` | LangGraph 1.x, Zod state, 8 nodes, `streamMode:"custom"` |
| seeded sample-app + issue inventory | `fixtures/apps/seeded-demo/` + `ground-truth.json` | Fresh small seeded fixture app authored for Handrail |
| target-app-config profiles | `ScanTargetSchema` in schemas + engine loaders | v2: crawl caps, auth, viewports, budget |

**Layering rule (enforced):** `schemas` ← `wcag`/`prompts`/`model` ← `engine` ← `orchestrator` ← surfaces (`cli`/`server`/`action`/`mcp`). Orchestrator nodes are one-line calls into engine steps; surfaces never import `@langchain/*`.

## Architecture essentials

### Contracts (`@handrail/schemas`)

- One `FindingSchema`: `{id, checkId, source: axe|heuristic:<id>|ai-text|ai-vision|eslint|typecheck (array = multi), sc[], scPrimary, tier: violation|likely|needs-review, severity: critical|serious|moderate|minor, confidence, evidence: Evidence[] (screenshot+bbox | dom excerpt | pixels | tool output), element{selector,xpath,domExcerpt,bbox}, page{url,pageStateId,viewport}, verification{method,status}, remediation{summary, snippets{html,react,vue}, sourceRef?{file,line,confidence}}, dedupeCount, pages?}`.
- **Schema invariant:** AI finding with zero evidence auto-downgrades to `needs-review` (Zod refinement).
- `ScanTargetSchema` (url|repo, crawl caps + template dedupe, auth storageState|loginSteps, viewports, budget), `ScanOptionsSchema` (deterministic|hybrid|hybrid-vision, wcagTarget, fix, budgetUsd), `ScanRecordSchema`, `ScanEventSchema` (discriminated union: phase.*, finding.detected, screenshot.captured, model.invoked, log), versioned `ReportSchema` + per-SC rollup schemas, `ModelInvocationSchema` (+costUsd, latencyMs, correlationId).

### Engine (`@handrail/engine`)

Modules: `capture/ crawl/ detect/ judge/ checks/(registry) verdict/ site/ score/ report/ fix/ cache/ cost/`.

- **StateCapture** (capture once, judge many): pageStateId, DOM snapshot, aria snapshot + CDP AX tree, **element index** (elemId, robust selector, xpath, role, accessible name, bbox, computed-style subset, focusability — never mutate target DOM), full-page+viewport PNGs (lazy crops via sharp), axe `violations`+`incomplete`+`passes`, console errors, media inventory.
- **Detection layers:** (A) axe-core (+ optional IBM equal-access `secondOpinion`, ceiling needs-review; skip HTML_CodeSniffer). (B) heuristics: `kbd.walk` (tab-order ≤200 stops), `kbd.focus-trap` 2.1.2, `kbd.focus-visible` 2.4.7 (style-delta then pixel-diff, animations frozen), `kbd.focus-obscured` 2.4.11, `kbd.skip-link` 2.4.1 (landmark guard), `ptr.target-size` 2.5.8 (exception ladder), `resp.reflow-320` 1.4.10, `resp.zoom-200` 1.4.4 (≡640px), `motion.auto-moving` 2.2.2, `media.autoplay-audio` 1.4.2, `form.autocomplete` 1.3.5, `link.color-only` 1.4.1. (C) LLM text judgment — one batched call per state over compact element-index extract: link purpose 2.4.4, labels 3.3.2/2.4.6, error messages 3.3.1/3.3.3, heading outline, page title 2.4.2, lang detection 3.1.2, alt-text triage. (D) vision judgment — triggered only: **alt-vs-image-content** (the "says football, shows dinner" check — crop + alt + context → boolean rubric), contrast-in-gradients (vision locates text, **our pixel math computes the ratio**), images of text 1.4.5, color-only signaling, visual reading order 1.3.2. (E) site-level: consistent nav 3.2.3 (LCS), consistent identification 3.2.4, multiple ways 2.4.5, consistent help 3.2.6; component dedupe → one finding with `pages[]`.
- **Verdict pipeline (trust core):** AI candidate → grounding (elemId must exist; DOM quote ≥90% fuzzy match; claimed attributes re-read from snapshot) → dedupe/merge → verification (deterministic re-checks per claim family; separate fresh-context Haiku verifier, boolean rubric) → **hard tier matrix**: deterministic evidence ⇒ `violation`; AI+verifier agree ⇒ `likely` max; unclear/equal-access-only/soft ⇒ `needs-review`. Rejected candidates → `hallucination-ledger.json` (telemetry only) ⇒ reported hallucination structurally ~0.
- **Crawler:** BFS same-origin + sitemap seed, URL normalization, template dedupe (`:id` collapse, 2/template), SPA routes via pushState interception; auth via storageState or scripted login (never screenshot login). Viewport matrix scoped: desktop full; mobile A+B; reflow320/zoom200/dark/forcedColors/reducedMotion targeted. Defaults: desktop+mobile+reflow320; maxPages 5 (hosted) / 25 (CLI).

### WCAG reference (`@handrail/wcag`)

All **55 WCAG 2.2 A+AA SC** as typed TS records (`Record<KnownScId, SC>` = compile-time completeness): level, principle, understanding summary, user impact, common failures, testability class, `detectionCoverage[{checkId,class}]`, manual test procedure, EN 301 549 clause, Section 508 flag, applicability detector. **axe map generated** from `axe.getRules()` tags → stamped file; CI asserts stamp matches installed axe + zero unmapped wcag-tagged rules. `coverageMatrix()` powers honest reporting.

### Scoring & reports

Per-SC rollup is the product: `fail > needs-review > pass (positive evidence required) > not-applicable (detector) > not-tested (listed, never hidden)` + coverage ledger. Headline: *"Automatically evaluated 38 of 55 A/AA criteria (24 pass-verified, 6 fail, 8 need review); 17 require human testing — checklist attached."* Secondary trend score (severity×log2 deduction) never presented as "accessibility score". Artifacts from canonical versioned `report.json`: self-contained `report.html` (bbox evidence overlays, filters; must pass Handrail's own scan — dogfood CI gate), SARIF 2.1.0 (GitHub code scanning, elemFingerprint partialFingerprints), `pr-summary.md` (delta vs baseline), `human-review-checklist.md`, **OpenACR/VPAT draft** (validates with `openacr` CLI; watermarked "machine-generated draft — requires human evaluation").

### Fix engine (Phase 4)

Repo mode: git-worktree sandbox → Sonnet per finding-group (sourceRef slice ±40 lines; output unified diff only, budget-capped, no dep/config changes) → apply → tsc/eslint → re-capture affected states → **resolved iff original findingId gone AND zero new findings** → one retry then propose-only. Source mapping: selector→source token matcher (ripgrep, graded confidence; React `_debugSource`/Vue `__file` when present). Priority: Tier-1 auto (alt, labels, accessible names, lang, title, duplicate ids, ARIA validity, autocomplete) → Tier-2 assisted → Tier-3 suggest-only (contrast proposes nearest compliant hex). Fix-plan approval via LangGraph `interrupt()`. URL mode: remediation snippets (html/react/vue), LLM wording marked "suggested".

### Eval harness (`@handrail/evals`)

`fixtures/wcag/<checkId>/<case>/` with `manifest.json` (`expected[]` + `traps[]` = correct-looking elements that must NOT be flagged); ~40 fixtures v1 (2/check + 3 kitchen-sink + 5 clean-control); **no check merges without fixtures**. DOM-node matching. Metrics per check/SC: precision, recall, F1, reported-hallucination (hard 0), candidate-rejection rate, needs-review yield, determinism (Jaccard), fix success, wall time, $. **CI:** deterministic gate every PR (precision 1.0 / recall ≥0.95, $0); nightly AI eval (~$2 cap, never fork PRs): precision ≥0.9, recall ratchet (max −2pts), hallucination=0 hard fail. W3C WAI BAD demo as smoke benchmark. **Comparison mode** emits the public artifact: "axe found X%, Handrail Y%, at 0 reported hallucinations."

### Hosted showcase (`apps/server` + `apps/web`)

API (Zod-validated, auto-OpenAPI): `POST /api/scans` (202, rate-limited) · `GET /api/scans/:id` · `/events` (SSE, Last-Event-ID replay via `scan_events` rows + LISTEN/NOTIFY) · `/report(.html|.sarif)` · `/artifacts/:id` · `/healthz` · `/readyz` (DB+queue+chromium smoke) · `/api/meta`(+stats p50/p95). pg-boss worker embedded (concurrency 1–2). Drizzle tables: scans, scan_events, findings, artifacts, eval_runs. Screenshots → R2, 14-day retention. **Abuse controls before URL is shared:** 3 scans/hr/IP + global cap 2; SSRF guard (scheme allowlist, DNS-resolve → block private/link-local/metadata, re-validate redirects); per-scan budgets (5 pages, 10-min, token cap); admin-token bypass. Web UI: paste URL → live phase timeline + streaming findings → report by WCAG principle, screenshot lightbox with bbox overlays, deterministic-vs-AI badges, cost footer. pino JSON logs, correlationId=scanId everywhere.

### Design system & self-accessibility (the glass-house rule)

An a11y tool with an inaccessible UI is dead on arrival — reviewers will tab through the app before reading the README. Standards are mechanical, not aspirational:

- **Accessible by construction:** `apps/web` uses **React Aria Components** (headless; battle-tested keyboard/focus/ARIA semantics — the on-brand choice) styled via **Tailwind design tokens** defined once (contrast-checked color pairs incl. dark theme, focus-visible rings, ≥24px target sizes, spacing/type scale). Components inherit compliance; nobody re-earns it per screen.
- **`docs/DESIGN.md`** (authored as the first slice of Phase 2, before any component): browser matrix (evergreen Chrome/Edge/Firefox/Safari), viewport/zoom matrix (320px reflow, 200% zoom, forced-colors, `prefers-reduced-motion` — the same things our engine checks), keyboard interaction pattern per screen, ARIA rules, copy tone, empty/loading/error state patterns.
- **CI dogfood gate:** Handrail scans its own UI (deterministic mode, $0) on every PR — kbd.walk + reflow + axe against ourselves; regressions fail the build. Strict `eslint-plugin-jsx-a11y` at lint time. **Manual NVDA (Windows) + VoiceOver (macOS) pass at each phase gate** — screen readers are where automation honestly ends, per our own thesis.
- **Claude working loop for UI slices:** implement → dev server in browser preview → screenshot → self-review against DESIGN.md → self-scan → commit. Recurring rituals become repo-local skills in `.claude/` (e.g. `design-review`, `pre-pr`) so every session applies the same standards without re-briefing.

### Cost engineering (enforced)

Screenshots normalized (≤1024w ≈2.7K tok; crops ≤300px ≈120 tok). Per-state budgets: text ≤8K/1.5K, vision ≤6K img+2K/1K, verifier ≤2K/300. **10-page scan: deterministic $0; hybrid ≈$0.25–0.80; hybrid-vision ≈$0.80, ceiling $1.50.** Degradation order: drop vision → drop text → deterministic. Judgment cache `sha256(model+promptVersion+checkId+inputDigest)` → >90% hits on templates/re-scans. Wall clock 10 pages: ≤5 min full, ≤2 min deterministic.

## Phased roadmap (solo, ~8–10 h/wk; every phase demoable)

| Phase | ~Time | Ships | Acceptance |
|---|---|---|---|
| **0 — Bootstrap** | 1 wk | `gh repo create <personal>/handrail` (public) at `~/dev/handrail` on the MacBook; pnpm workspace scaffold + strict tsconfig + vitest + `ci.yml` (lint/typecheck/unit on ubuntu+macos+windows — OSS users span all three; browser/eval jobs ubuntu-only); **LICENSE (MIT) first commit**; README product story; AGENTS.md; ADR-0000/0001/0002; `@handrail/schemas` v1 (Finding/ScanTarget/Event/Report) with unit tests; fresh `fixtures/apps/seeded-demo` (small React app, ~10 seeded issues incl. a lying alt text) + ground-truth.json | CI green on fresh clone; schemas round-trip; fixture app runs |
| **1 — Engine + CLI** | 3–4 wk | `@handrail/wcag` (55 SC + generated axe map); `@handrail/engine` capture core (StateCapture, element index, axe incl. incomplete/passes) + first heuristics (`kbd.walk`, `kbd.focus-visible`, `ptr.target-size`, `resp.reflow-320`); `@handrail/model` (anthropic-messages + bedrock + deterministic, strict errors, cost ledger); text judge + verdict pipeline v1; `@handrail/orchestrator` (LangGraph 1.x, 8 nodes, custom stream); `apps/cli` `handrail scan <url> --mode hybrid --report html` live progress | CLI scans 3 arbitrary public sites → evidence-backed WCAG-mapped report.json+html; deterministic mode offline $0; seeded-demo recall vs ground truth recorded as baseline; **golden-scan snapshot committed + model record/replay cassettes running in CI with no API key** |
| **2 — Hosted showcase** | 4 wk | **DESIGN.md + Tailwind tokens first slice**; apps/web on React Aria Components; apps/server; Dockerfile (Playwright base) + compose; Railway deploy + R2; rate-limit/SSRF/budgets; healthz/readyz; pino+correlation ids; `.claude/` repo skills (design-review, pre-pr); DEMO.md | Public URL: paste site → watch findings stream → shareable evidence report; scan survives restart; SSRF attempts rejected; stats endpoint live; **UI passes its own deterministic scan in CI (dogfood gate)** + manual VoiceOver pass; deploy.yml post-deploy smoke green + rollback runbook tested once |
| **3 — Trust + evals** | 3 wk | Vision judge (alt-vs-image, contrast pixel math, color-only) + crop pipeline; `@handrail/evals` + ~40-fixture corpus + clean-control + adversarial-injection page; CI deterministic gate + nightly AI eval + ratchet; EVALS.md scorecard → README badge | CI fails on regression drill; clean-control = 0 AI FPs at violation/likely; lying-alt fixture caught with screenshot evidence; scorecard auto-generated |
| **4 — Fix engine + CI surface** | 4 wk | LLM unified-diff fixes (worktree sandbox, verified loop, `interrupt()` approval); source matcher; apps/action (PR comment, SARIF upload, fail-on-threshold, optional fix-PR) | Action on fixture repo: PR comment + SARIF in GitHub UI; ≥6/10 seeded issues fixed verified, zero regressions on clean-control; Tier-1 fix success ≥80% |
| **5 — Launch** | ongoing | Remaining heuristics + site-level checks + crawler polish; OpenACR draft; apps/mcp (stdio: scan, get_report); comparison-mode artifact; CONTRIBUTING/SECURITY/templates/demo GIF; npm publish; **Show HN + LinkedIn launch**; HCL internal adoption via published packages + Bedrock docs | MCP works in Claude Code; README scorecard beats axe-only baseline; npm install works cold; launch posts live |

First demoable: end of Phase 2 (~2 months). "Best in market" defensible at Phase 3 (published precision/recall), complete at Phase 5.

## Dev workflow & CI quality gates (from the first commit — never "later")

GitHub Actions is free on public repos (hosted runners incl. macOS/Windows), so none of this has a cost barrier.

**Working style**

- Trunk-based, short-lived branches: every change = branch → PR → squash-merge. **Branch protection on main from Phase 0**: required status checks (lint, typecheck, unit, eval-deterministic, golden-scan), no reviewer requirement, self-merge allowed — PRs exist for the checks and the portfolio-visible history, not ceremony.
- **Fixture-first development is this project's TDD**: for every new check, author the fixture page + expected ground truth BEFORE the implementation (the failing eval is the failing test). Pure logic (schema refinements, scoring, SSRF guard, cost math) gets colocated vitest unit tests written with the code. No dogmatic red-green for glue.
- Pre-commit: lefthook (eslint --fix + typecheck on staged packages, fast); CI remains the real gate.
- Supply chain (part of the enterprise story): `pnpm audit` in CI (fail on high), Dependabot weekly, CodeQL (free on public repos).

**Verification pyramid for AI-dependent code** (the "frozen trace replay" layers)

1. `local-deterministic` mode — synthetic outputs, $0; powers unit/integration tests + the every-PR eval gate.
2. **Record/replay cassettes**: `@handrail/model` supports `MODEL_MODE=record|replay`. Record captures REAL provider responses keyed by `(role, promptVersion, inputDigest)` into committed JSON cassettes; replay serves them in CI with zero API keys — catching prompt/parsing/schema regressions against actual model behavior. `pnpm cassettes:refresh` (budget-capped) re-records when prompts/models change; a stale-cassette check warns when promptVersion ≠ cassette version.
3. **Golden scan snapshot**: full deterministic scan of `fixtures/apps/seeded-demo` → normalized event stream + report.json (timestamps/ids/paths stripped) diffed against committed goldens. Orchestration/shape drift fails CI with a readable diff; intentional changes update goldens in the same PR.
4. Live nightly AI evals (budget-capped, ratcheted) — per §Eval harness.

**Deploy pipeline (lands with Phase 2)**: `deploy.yml` runs on main only after `ci.yml` is green → Drizzle migrations as an explicit pre-start step → Railway deploy → **post-deploy smoke**: poll `/readyz` until green, submit a 1-page scan of the app's own landing page, assert completion + schema-valid report → on failure, Railway one-click rollback to the previous image (runbook in OPERATIONS.md). Env/config changes ride the same PR path; `.env.example` is the contract.

## Trust & safety invariants (from Phase 1, tested from Phase 3)

1. No silent model fallback — degraded scans say so. 2. AI finding without evidence can't ship above `needs-review` (schema-enforced). 3. Tier ceilings by provenance (hard matrix). 4. SSRF: DNS-pin + private-range block + redirect re-validation; container holds only R2+DB creds. 5. Prompt injection: page content delimited as data, reviewer role has no tools, adversarial fixture in CI. 6. Never bypass bot-detection/CAPTCHAs — partial results with honest coverage instead. 7. Screenshots may contain PII → private R2, 14-day retention, never in logs.

## Docs

README (thesis, badges incl. nightly eval score, quickstart, scorecard, honest competitor table) · ARCHITECTURE.md (**opens with ~500-word exec summary**) · USERS.md (HCL QA under EAA/ADA deadlines, frontend dev, a11y specialist, eng manager, OSS contributor) · **DESIGN.md** (tokens, browser/viewport matrix, keyboard patterns, ARIA rules — Phase 2 first slice) · EVALS.md · THREAT_MODEL.md · COST.md (measured, @100/1K/10K scans) · OPERATIONS.md · DEMO.md · ROADMAP.md (deferred: accounts/SSO, PDF/video audits, Guidepup screen-reader automation, WCAG 3.0 scoring, mobile-native) · docs/adr/.

## Verification per phase

- **P0:** fresh `git clone` → `pnpm i && pnpm test` green on ubuntu+macos (+windows unit job); fixture app boots.
- **P1:** `handrail scan` on 3 public sites → report validates against schema; `--mode deterministic` offline; baseline recall JSON committed.
- **P2:** `docker compose up` full scan locally on Windows; Railway smoke: submit scan, kill worker mid-run (resumes), 429 on 4th scan/hr, SSRF probes (localhost, 169.254.169.254) rejected.
- **P3:** regression drill (intentionally break a check → CI fails); adversarial page yields zero instruction-following; lying-alt fixture demo recorded.
- **P4:** Action on fixture-repo PR → annotations + SARIF visible; fix-PR opens with verified diff.
- **P5:** cold-machine `npx handrail scan` works; MCP scan from Claude Code; `openacr validate` passes; report.html passes Handrail's own scan.

## Risks

| Risk | Mitigation |
|---|---|
| Hallucinated findings destroy trust | Evidence-mandatory schema, grounding+verifier, tier ceilings, clean-control FP gate, source badges |
| LLM cost blowout | Tiered models, enforced budgetUsd, caching, deterministic-always-free, measured COST.md |
| Playwright flakiness on arbitrary sites | Partial-results-by-design + coverage statement, banner heuristics, timeouts, curated demo list |
| Scanner as attack surface (SSRF/injection) | Guards + THREAT_MODEL.md + CI adversarial fixture |
| Scope creep / solo burnout | Phase gates; deferred list in ROADMAP.md; web+CLI excellent before action/MCP |
| macOS dev vs Linux deploy drift (+ Windows OSS users) | execa spawn (no platform hardcodes), docker-compose parity loop before deploys, 3-OS unit matrix in CI |
| IP hygiene | Personal repo + personal laptop + personal time from day 1, fresh code, spike as reference only; one-time skim of HCL agreement's moonlighting/IP clause. Green card ⇒ no immigration constraints on paid side work |

## First implementation session (Phase 0) — runs on the personal MacBook (see §0)

1. Copy this plan into the new repo as `docs/PLAN.md` (roadmap of record).
2. In `~/dev/handrail`: `git init`; `gh repo create` (public) under the personal GitHub account (personal gh login, not HCL).
3. Commit 1: LICENSE (MIT) + README stub + .gitignore + .editorconfig.
4. Scaffold pnpm workspace (pnpm-workspace.yaml, tsconfig.base strict, vitest, eslint 9 flat config), engines `>=22.12`.
5. `@handrail/schemas` v1 + unit tests; `ci.yml` (ubuntu+windows: lint/typecheck/test).
6. ADR-0000 (convention), ADR-0001 (LangGraph on merit; spike history summarized), ADR-0002 (stack: Fastify/pg-boss/Postgres/R2/Railway; tsx runtime).
7. Fresh `fixtures/apps/seeded-demo` (React+Vite, ~10 seeded issues incl. lying alt text, missing labels, focus suppression, low contrast, keyboard trap) + `ground-truth.json`.
8. AGENTS.md (product memory: "Current state / Next up / Known gotchas" header per §0.1). Conventional commits, one coherent slice each.
9. `gh` milestones for Phases 1–5 + ~5–10 issues per phase generated from this plan's roadmap tables (per §0.1); each issue carries its acceptance criterion.
10. Repo settings via `gh`: branch protection on main (required checks: lint/typecheck/unit/eval-deterministic), Dependabot weekly, CodeQL enabled; lefthook pre-commit installed. From this point on, all work happens on branches → PRs.
