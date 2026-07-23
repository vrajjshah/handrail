# ADR-0002: Runtime and hosting stack

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Handrail needs a hosted showcase that a stranger can point at a URL and watch
work, plus a CLI that runs offline for free. It is funded by one person's side
budget, operated by one person, and is expected to be forked and self-hosted by
enterprises (the HCL adoption path). Those three constraints — cheap, operable
solo, and self-hostable — decide most of the stack.

## Decision

**Hosting: Railway.** One Dockerfile built on the Playwright base image, managed
Postgres, roughly $5–15/month. `SERVICE_ROLE=api|worker|both` picks the process
role out of a single image, so local `docker compose` and production run the same
artifact. Screenshots go to Cloudflare R2 with 14-day retention.

**Queue: pg-boss, not Redis.** Job state lives in the Postgres we already pay for.
One less service to run, one less thing to restore, and job history is queryable
with the same client as everything else. Concurrency of 1–2 is enough for a demo
whose per-scan budget is capped anyway.

**Server: Fastify 5 + `fastify-type-provider-zod`.** The Zod contracts in
`@handrail/schemas` are already the source of truth; this makes them the request
validation *and* the generated OpenAPI document, so the API cannot drift from the
schemas without failing typecheck.

**Data access: Drizzle.** SQL-shaped, no runtime, migrations as committed files
that run as an explicit pre-start step in the deploy pipeline.

**Web: React 19 + Vite + Tailwind 4 + TanStack Query, on React Aria Components.**
The component library is a trust decision, not a taste one: an accessibility tool
whose own UI fails a keyboard test is unshippable, so the primitives ship with the
keyboard and ARIA semantics already correct. See the glass-house rule in
`docs/PLAN.md`.

**Streaming: SSE with `Last-Event-ID` replay** over `scan_events` rows plus
Postgres `LISTEN`/`NOTIFY`. `ScanEvent.seq` is monotonic per scan and doubles as
the SSE event id, which makes reconnect-replay exact rather than approximate.

**Runtime: Node `>=22.12`, tsx through Phase 2.** tsx keeps the loop fast while the
shape of the code is still moving. Revisit at the Phase 3 boundary, when the
packages have settled and published build output starts to matter.

**Zod 4 from the first commit.** New repo, no migration to pay for.

**Playwright pinned to its Docker base image tag.** Browser and library version
must move together or captures drift between local and deployed runs.

## Consequences

- Postgres is a single point of failure for scans, events, and the queue at once.
  Accepted deliberately at this scale: managed backups, and a scan is cheap to
  re-run.
- Railway is not the cheapest at scale and is a lock-in of sorts, but the exit is a
  Dockerfile and a Postgres dump. Self-hosters get the same two artifacts.
- One image serving both roles means a worker crash-loop can take API capacity with
  it. `SERVICE_ROLE` exists so the two can be split without a rebuild when that
  becomes real.
- `/readyz` must prove Postgres, the queue, and a Chromium smoke launch, because
  "the container is up" and "a scan can actually run" are different claims and only
  the second one matters.
