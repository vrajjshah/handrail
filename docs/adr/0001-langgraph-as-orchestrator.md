# ADR-0001: LangGraph as the orchestrator

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

A scan is a long-running, multi-stage, partly-parallel workflow that has to stream
progress, survive a worker restart, pause for human approval before applying
fixes, and stay observable when a model call fails halfway through. That is an
orchestration problem, and it needs a framework decision.

A prior spike (kept internal, referenced only) compared **LangGraph** against
**Mastra** on a WCAG review → fix → verify workflow. It ended in a mechanical
84–84 tie, and its own conclusion was that *workflow design matters more than
framework branding*. The tie is therefore not a tie-break, and this decision was
taken fresh on merit rather than inherited from the spike's score.

The single largest factor in Mastra's favour in that spike was that it ships an
app framework. Handrail does not need one: the plan already commits to a Fastify
server and a Vite SPA, both of which we want to own outright for the hosted
showcase. That advantage is neutralised by the architecture we were going to build
anyway.

## Decision

Use **LangGraph 1.x** as the orchestration layer, in `@handrail/orchestrator`.

What decided it:

- **Checkpointing on our own Postgres.** The plan already runs managed Postgres for
  scans, events, findings, and the pg-boss queue. LangGraph's Postgres checkpointer
  rides that same database, so "scan survives a worker restart" — a Phase 2
  acceptance criterion — costs a connection string rather than another service.
- **`interrupt()` as a first-class human gate.** Phase 4's fix-plan approval is
  exactly this primitive. Building the same pause/resume semantics by hand on top
  of a queue is where solo projects quietly lose a week.
- **`Send` fan-out** for per-page-state judgment, which is the natural parallel
  shape of "capture once, judge many".
- **Custom stream events** (`streamMode: "custom"`) map cleanly onto `ScanEvent`
  and therefore onto SSE, the CLI progress renderer, and the golden-scan snapshot —
  one event vocabulary for every surface.
- **Ecosystem and portfolio weight.** For a project whose first job is reputation,
  the more legible choice is worth real points, and the hiring signal is not
  symmetric between the two.

## Consequences

- `@langchain/*` is a dependency of `@handrail/orchestrator` and of **nothing
  else**. The layering rule is enforced: surfaces (`cli`, `server`, `action`,
  `mcp`) never import it, and orchestrator nodes are one-line calls into
  `@handrail/engine` steps.
- All real logic lives in the engine, which is plain TypeScript with no
  orchestration dependency. If LangGraph turns out to be wrong, the blast radius
  is one package and the node wiring inside it — the checks, the verdict pipeline,
  and the report generator do not know it exists.
- We accept LangGraph's state-shape ergonomics, which are more ceremony than a
  hand-rolled pipeline would need. Zod state annotations keep it typed.
- Mastra remains a legitimate alternative. Nothing here is a claim that it is
  worse — only that its main advantage does not apply to an architecture that owns
  its own server and UI.
