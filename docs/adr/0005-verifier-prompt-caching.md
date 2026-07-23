# ADR-0005: Accept that Phase 1's Haiku prompts do not prompt-cache

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[ADR-0004](0004-phase-1-freshness-check.md) found a hole in the plan's cost
model. `docs/PLAN.md` §Cost engineering budgets the verifier at "≤2K input / 300
output", and §Models says to prompt-cache the stable prefix across judgment
calls. But the minimum cacheable prefix is model-dependent, and **for Haiku 4.5
it is 4096 tokens**. A ≤2K verifier prompt is below that floor, so the cache
silently never populates: no error, `cache_creation_input_tokens` simply reads 0.

ADR-0004 deferred the decision to "the Phase 1 issue that builds the verifier".
This is that issue (#10), and these are its three options as recorded there:

1. Accept it — the verifier is cheap per call and caching it saves little.
2. Run the verifier on Sonnet 5, whose floor is 2048 tokens.
3. Grow the verifier prefix past 4096 tokens deliberately so it caches.

**Building both prompts showed the hole is wider than ADR-0004 recorded.** The
floor is above *both* Phase 1 Haiku prefixes, not just the verifier's:

| Role | System prefix | ≈ tokens | Haiku 4.5 floor | Caches? |
|---|---|---|---|---|
| `verifier` | 1,273 chars | 320–400 | 4096 | no |
| `text-judge` | 9,793 chars | 2,450–3,060 | 4096 | no |

The judge's figure is *after* it grew. It was ~1,000 tokens until the WCAG
reference block was added — the nine criteria's understanding statements, user
impact and common-failure lists, generated from `@handrail/wcag` rather than
paraphrased. That was done on judgment-quality grounds, and it is what the plan
means by "system prompt + WCAG reference". It roughly tripled the prefix for a
good reason and *still* did not reach the floor.

That is the useful signal in this whole exercise: a prompt that has to be padded
to 4096 tokens to cache is a prompt being written for the cache.

## Decision

**Option 1, for both roles. The prompts stay the size the work makes them, and
Phase 1 gets no prompt-cache benefit.**

The cache breakpoint stays on the `system` prefix — the provider seam sets it
unconditionally — so nothing needs changing if a future Haiku lowers its floor or
a prefix grows past it on merit. It simply will not fire today, and `COST.md`
will say so, from measured `cache_read_input_tokens` rather than an assumed hit
rate.

### Why not option 3, which the arithmetic appears to favour

Padding is the option that looks free and is not. Input-token cost at Haiku 4.5
rates ($1/MTok input, cache write 1.25×, cache read 0.1×), for the verifier with
a ~400-token prefix and ~600 tokens of per-claim facts:

| | first call | each later call | 40 calls |
|---|---|---|---|
| Today (uncached) | $0.0010 | $0.0010 | **$0.040** |
| Padded to 4096 + 600 | $0.0057 | $0.0010 | **$0.045** |

For the verifier, padding never breaks even: the padded prefix's cache *read*
alone bills 410 tokens, about what the entire unpadded prompt costs today, so the
1.25× write is never repaid and a padded verifier is simply more expensive
forever. The judge is the other way round — it clears break-even after about the
second page state — and the saving there is roughly **$0.02** on a 10-page scan.

Two cents is not worth what it buys. Reaching 4096 tokens means adding ~1,300
tokens to the judge and ~3,700 to the verifier whose only design requirement is
that they exist. The verifier's rubric is four booleans and a sentence, and its
shortness is not incidental: that call exists to be *hard to talk out of a "no"*,
and every additional token is another thing it can pattern-match a claim onto
instead of reading the facts in front of it. Trading the one quality lever these
calls have for a rounding error is a bad trade, and it is a trade whose cost only
ever shows up later, in a precision number nobody can attribute.

Two smaller reasons point the same way. Padding makes the *first* call of every
cold scan several times more expensive, so a single-page scan — the CLI's common
case and the hosted demo's only case — pays for the cache and never uses it. And
the 5-minute cache TTL means a scan whose calls are spread across a slow crawl
re-pays the write more than once.

### Why not option 2

Moving the verifier to Sonnet 5 buys a 2048-token floor at three times the
per-token price, on the role chosen specifically for being cheap and
high-volume — and at ~400 tokens the verifier would not clear that floor either.
It also weakens the independence claim rather than strengthening it: Sonnet 5 is
already the vision and fix model, so the verifier would share a model with more
of the pipeline, not less.

## Consequences — a correction to the plan, not just to the verifier

**§Models' "~90% cached-input savings within a scan burst" does not apply to any
Phase 1 call.** `docs/PLAN.md` is amended accordingly. The saving is still
reachable in Phase 3, where a Sonnet 5 vision call carries an image and clears
that model's 2048-token floor comfortably — but it must be *measured there*, not
assumed here.

The cost band survives without it. Uncached, at Haiku 4.5 rates, one text judge
call per page (~4,750 tokens in, ~600 out) is $0.0078, and one verifier call per
surviving candidate (~1,000 in, ~120 out) is $0.0016. A 10-page scan with four
surviving candidates per page is **≈$0.14 for the whole text layer** — well
inside the plan's $0.25–0.80 hybrid band, which also has to cover triage and
vision. Nothing needs re-planning; the estimate was simply right for the wrong
reason.

Also:

- The verifier's `system` prefix is deliberately short. **Do not grow it to reach
  the cache floor.** If it grows, that has to be because the rubric got better.
- The judge's prefix is generated from `@handrail/wcag`, so a corrected criterion
  record corrects the prompt. Adding a claim family grows it for free and for the
  right reason.
- `COST.md` is generated from measured `cache_read_input_tokens`. Both Haiku
  roles will show 0 cache reads and a full-price input line. That is correct and
  should not be "fixed" in the report.
- **Revisit trigger, measured not vibed:** reopen when either (a) `COST.md` shows
  the Haiku roles above **25% of total scan cost**, or (b) a prefix clears 4096
  tokens on merit, at which point caching starts working with no code change and
  this ADR just becomes history.
