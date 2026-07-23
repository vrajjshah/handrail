# ADR-0000: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Handrail is built solo, in roughly two-to-four-hour sessions, often with a fresh
agent context each time. The failure mode that costs the most is not a wrong
decision — it is a decision that gets re-litigated three weeks later because
nobody wrote down why it was made, and the reasoning has to be reconstructed from
the code.

`docs/PLAN.md` is the roadmap of record and holds the decisions that were made up
front. ADRs are for everything decided after it, and for amending it when reality
disagrees.

## Decision

Every decision that would be expensive to reverse gets an ADR in `docs/adr/`,
named `NNNN-kebab-title.md`, numbered sequentially from 0000.

Each ADR states **Status**, **Date**, **Context**, **Decision**, and
**Consequences**. Superseded ADRs are never deleted or edited into agreement with
the present — they get `Status: Superseded by ADR-NNNN`, because the wrong turn is
often the most useful part of the record.

What earns an ADR:

- Anything in the plan's locked-decisions table that changes.
- Framework, runtime, datastore, hosting, and provider choices.
- Contract shapes other packages build against.
- Trust and safety invariants, and any relaxation of one.
- Pinned versions where the pin is load-bearing rather than incidental.

What does not: naming, file layout, formatting, and anything a reader can infer
from the code in under a minute.

Per `docs/PLAN.md` §0.1, when a phase-start freshness check finds that the world
has moved — a library major, a model id, a price — the response is an ADR plus an
amendment to `docs/PLAN.md` **in the same commit**. The plan is never rebuilt from
scratch over drift.

## Consequences

- A new session can read `docs/PLAN.md`, `AGENTS.md`, and the ADR index and be
  current without reading the git log.
- The public ADR trail is also portfolio evidence: it shows the reasoning, not
  just the result.
- Small ongoing cost: a decision made in a session must be written down in that
  session, or it will not be written down at all.
