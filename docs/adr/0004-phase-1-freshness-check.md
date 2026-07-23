# ADR-0004: Phase 1 freshness check

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Plan §0.1 requires a freshness check at each phase boundary: verify the phase's
pinned library versions, model ids, and pricing against current sources, and
record any drift as an ADR plus a `docs/PLAN.md` amendment in the same commit.
This is that record for Phase 1.

## Decision

**The plan's model table is accurate as written — no drift.** Verified 2026-07-23:

| Plan says | Verified |
|---|---|
| `claude-haiku-4-5`, $1/$5 per MTok | Correct |
| `claude-sonnet-5`, $3/$15, intro $2/$10 through 2026-08-31 | Correct, including the intro window |
| Sonnet 5 high-res vision, 2576px | Correct — first Sonnet-tier model with it |
| Sonnet 5 tokenizer ≈30% more text tokens than 4.x | Correct |
| Native structured outputs via `output_config.format` + `zodOutputFormat` | Correct; supported on both Haiku 4.5 and Sonnet 5 |
| Prompt caching ≈90% saving on cached input | Correct — cache reads bill at ≈0.1× |

**Phase 1 libraries are all current and match the plan's assumptions.** LangGraph
1.4.8 (plan says "1.x"), Playwright 1.61.1, axe-core 4.12.1, `@axe-core/playwright`
4.12.1, sharp 0.35.3, execa 10.0.0, `@anthropic-ai/sdk` 0.113.0,
`@anthropic-ai/bedrock-sdk` 0.32.0, `accessibility-checker` 4.0.29 (IBM
equal-access). Nothing to amend.

**The plan's count of 55 A/AA criteria is correct** and was independently
re-derived while building `@handrail/wcag`: 30 at Level A, 25 at Level AA. Note
that WCAG 2.2 **removed 4.1.1 Parsing** and added six criteria (2.4.11, 2.5.7,
2.5.8, 3.2.6, 3.3.7, 3.3.8) — a reference built against 2.1 will have the wrong
denominator, and the whole coverage story depends on that denominator being right.

### API-shape constraints for `@handrail/model` (new information)

These are not drift — the plan predates them being relevant — but Phase 1's
provider seam has to honour them or requests will 400:

- **`temperature`, `top_p`, `top_k` are rejected at non-default values on
  Sonnet 5.** The seam must not expose a temperature knob for that provider.
  Steering is by prompt only.
- **`budget_tokens` is removed.** Use `thinking: {type: "adaptive"}` plus
  `output_config.effort`.
- **Adaptive thinking is on by default when `thinking` is omitted on Sonnet 5.**
  Since `max_tokens` caps thinking *and* response together, a call that assumes
  no thinking can truncate. Set the mode explicitly on every call rather than
  relying on the default.
- **`thinking.display` defaults to `"omitted"`.** Thinking blocks arrive with
  empty text unless we ask for `"summarized"`. We do not surface model reasoning
  in reports, so the default is what we want — but the judgment-cache key must not
  accidentally depend on empty thinking text.
- **Bedrock only:** a forced `tool_choice` requires `thinking: {type: "disabled"}`.
  The capability map has to encode this as a provider difference rather than
  discovering it at runtime.

## Consequences — one correction to the plan's cost model

**The plan's verifier budget cannot benefit from prompt caching, and the plan
implies it can.** §Cost engineering sets the verifier at "≤2K input / 300 output"
while §Models says to prompt-cache the stable prefix across judgment calls. But the
minimum cacheable prefix is model-dependent, and for **Haiku 4.5 it is 4096
tokens** — a ≤2K verifier prompt is below the floor, so it will silently not cache.
There is no error; `cache_creation_input_tokens` is simply 0.

That is a real hole in the cost model, so it is recorded rather than quietly
absorbed. Three options, to be decided in the Phase 1 issue that builds the
verifier, not here:

1. Accept it — the verifier is cheap per call and caching it saves little in
   absolute terms.
2. Run the verifier on Sonnet 5, whose floor is 2048 tokens — worse per-token, but
   cacheable.
3. Grow the verifier prefix past 4096 tokens deliberately (fuller rubric, more
   few-shot examples), so it caches and the extra prefix is nearly free after the
   first call.

Option 1 is the presumption until measured. **`COST.md` must be built from measured
`cache_read_input_tokens`, not from assumed cache hits** — this is exactly the class
of error that an assumed-savings spreadsheet hides.

Also worth carrying into Phase 3: at 2576px, a single full-resolution image on
Sonnet 5 can cost ~4784 tokens, roughly 3× the old 1568px ceiling. The plan's
normalization to ≤1024w keeps us well under that, so the ≈2.7K-token screenshot
figure stands — but the normalization step is now load-bearing for cost, not just
for latency.
