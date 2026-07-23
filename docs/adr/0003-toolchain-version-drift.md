# ADR-0003: Toolchain versions differ from the plan's pins

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

`docs/PLAN.md` was written as a July 2026 snapshot and pins "vitest ^3", "eslint 9
flat config", and Zod 4. Plan §0.1 requires a freshness check at each phase
boundary, with drift recorded as an ADR plus a plan amendment rather than a
rewrite. This is that record for Phase 0.

What the registry actually offered on 2026-07-23:

| Package | Plan | Latest | Chosen |
|---|---|---|---|
| typescript | (unpinned) | 7.0.2 | **6.0.3** |
| eslint | 9 | 10.7.0 | **10.7.0** |
| vitest | ^3 | 4.1.10 | **4.1.10** |
| zod | 4 | 4.4.3 | **4.4.3** |
| typescript-eslint | — | 8.65.0 | **8.65.0** |

## Decision

**TypeScript 6.0.3, not 7.0.2.** This is the only pin that goes against "latest",
and it is forced: `typescript-eslint@8.65.0` declares
`peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TypeScript 7 is the native port,
and typed linting has not caught up to it. Typed lint rules are load-bearing here —
they are what catch the unsafe-`any` paths in code that parses untrusted model
output — so the linter wins over the compiler version. Revisit when
typescript-eslint widens its peer range.

**ESLint 10, not 9.** The plan's actual requirement is flat config, which is the
only config format ESLint 10 supports. Taking the major satisfies the intent.

**Vitest 4, not 3.** No blocker, and starting a new repo one major behind buys
nothing.

**Zod 4** as planned.

One Zod 4 API note worth recording, because it cost time and will cost it again:
`.default()` takes the schema's **output** type, so `.default({})` fails on any
object whose fields have their own defaults. `.prefault({})` is the one that feeds
a value *through* parsing and applies inner defaults. The schemas use `.prefault()`
for nested config objects.

## Consequences

- `pnpm install` will keep reporting that TypeScript 7 is available. That notice is
  expected; the pin is deliberate and this ADR is the reason.
- The Phase 1 freshness check should re-test the typescript-eslint peer range. If
  it has widened, moving to TypeScript 7 is a one-line change plus a typecheck run,
  and supersedes this part of the ADR.
- `docs/PLAN.md` keeps its original pins with the amendment block pointing here,
  per §0.1: the plan is amended, never rebuilt.
