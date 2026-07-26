# ADR-0006: Phase 2 freshness check

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

`docs/PLAN.md` §0.1 requires a ~15-minute freshness check at each phase
boundary: verify the phase's pinned library versions against current reality and
record any drift as an ADR plus a plan amendment, in the same commit. This is
that check for **Phase 2 — Hosted showcase**, run at the start of #14.

The plan's Locked-decisions row for the server stack reads: *Fastify 5 +
`fastify-type-provider-zod` (auto-OpenAPI), pg-boss (queue in Postgres, no
Redis), Drizzle, SSE with Last-Event-ID replay, React 19 + Vite SPA + Tailwind 4
+ TanStack Query.* §Design system adds React Aria Components and strict
`eslint-plugin-jsx-a11y`.

## What was checked

Every package the plan names for Phase 2, resolved from npm on 2026-07-25:

| Package | Plan says | Current | Verdict |
|---|---|---|---|
| `fastify` | 5 | 5.10.0 | as planned |
| `fastify-type-provider-zod` | (unpinned) | 7.0.0 | as planned |
| `@fastify/swagger` | implied by "auto-OpenAPI" | 9.8.1 | **now a required peer** — see below |
| `pg-boss` | (unpinned) | 12.26.3 | as planned |
| `drizzle-orm` / `drizzle-kit` | (unpinned) | 0.45.2 / 0.31.10 | as planned |
| `react` / `react-dom` | 19 | 19.2.8 | as planned |
| `react-aria-components` | (unpinned) | 1.19.0 | as planned |
| `tailwindcss` | 4 | 4.3.3 | as planned |
| `@tanstack/react-query` | (unpinned) | 5.101.4 | as planned |
| `vite` | (unpinned) | 8.1.5 | major moved; no plan claim to contradict |
| `pino` | (unpinned) | 10.3.1 | as planned |
| `eslint-plugin-jsx-a11y` | (unpinned) | 6.10.2 | as planned |

**No drift against a locked decision.** Every framework the plan names is
available at the major version it names, and nothing in the Phase 2 row needs
rewriting. That is the outcome the check exists to establish, and it is worth
recording precisely because the Phase 1 check ([ADR-0004](0004-phase-1-freshness-check.md))
also read "no drift" on the surface and still turned up a real hole underneath.

## What the check turned up anyway

1. **`fastify-type-provider-zod@7` requires `zod >= 4.1.5`.** The repo is on
   Zod 4.4.3, so the plan's "schemas are the validation and the OpenAPI document
   both" works without a shim. On Zod 3 it would not have.
2. **OpenAPI generation is not built into the type provider.** `@fastify/swagger`
   (>= 9.5.1) is a hard peer dependency, and the JSON-Schema conversion the
   provider performs is only reachable through it. The plan's phrase
   "auto-OpenAPI" therefore costs two dependencies, not one — recorded here so
   #16 does not read it as a surprise.
3. **`pg-boss@12` declares `engines.node >= 22.12.0`**, which matches the repo's
   own floor exactly. No accommodation needed, but it does mean the Node pin in
   `.node-version` (22.23.1) is now load-bearing for the queue as well as the
   toolchain.
4. **Vite is at 8.x**, two majors past what existed when the plan was written.
   The plan never pinned it, so there is nothing to amend; noted so a later
   session does not "correct" it back to 5 on the strength of a memory.

## Decision

Proceed with Phase 2 exactly as the plan describes it. Pin at the versions in
the table above. Add `@fastify/swagger` to the Phase 2 dependency set as a
consequence of the type provider's peer requirement, and note in `docs/PLAN.md`
that "auto-OpenAPI" resolves to that pair.

## Consequences

- No plan rewrite. One clarifying amendment on the OpenAPI dependency pair.
- The Phase 2 issues can pin versions without each re-deriving them.
- The next freshness check is at the Phase 3 boundary, and it has a real target:
  §Models' vision claims (Sonnet 5 pricing, the 2576px ceiling, and whether the
  prompt-caching floor that [ADR-0005](0005-verifier-prompt-caching.md) blocked
  on Haiku is reachable on Sonnet) are unverified since 2026-07-23.
