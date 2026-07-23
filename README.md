# Handrail

**The open-source AI accessibility engineer.** Handrail scans a site or a repo, finds WCAG 2.2
A/AA problems that rule engines structurally cannot find, proves every finding with evidence, and
tells you honestly what it did *not* check.

> **Status: Phase 0 (bootstrap).** Nothing scans yet. The roadmap of record is
> [`docs/PLAN.md`](docs/PLAN.md); progress is tracked in GitHub milestones per phase.

## Why this exists

Rule engines — axe-core, Pa11y, Lighthouse, WAVE, IBM Equal Access — catch roughly **30–57%** of
WCAG issues. They are excellent at what is mechanically decidable and silent about everything else.
The tools that close the gap with AI (Deque axe DevTools AI, Evinced, GitHub's Copilot-cloud
scanner, WCAG-Scanner) are all closed source. Open source has thin MCP wrappers around axe and not
much more.

Nobody in OSS ships keyboard-simulation heuristics, vision judgment, honest per-criterion coverage,
verified fix loops, or published precision/recall numbers. That is the gap Handrail is built to fill.

## The thesis: trust is the product

An accessibility tool that invents findings is worse than no tool, because it burns the reviewer's
time and then their trust. Handrail's core is not the LLM — it is the **verdict pipeline** that
stands between the LLM and your report:

- **Evidence is mandatory.** An AI finding with zero evidence cannot be represented as a violation —
  the schema itself downgrades it to `needs-review`. This is a Zod refinement, not a code review rule.
- **Grounding before judgment.** Every AI candidate must name an element that actually exists in the
  captured element index, and any DOM it quotes must fuzzy-match the real snapshot.
- **Tier ceilings by provenance.** Deterministic evidence ⇒ `violation`. AI plus an independent
  verifier agreeing ⇒ `likely`, never higher. Anything unclear ⇒ `needs-review`.
- **Honest coverage, never a vanity score.** The headline is *"automatically evaluated 38 of 55 A/AA
  criteria; 17 require human testing — checklist attached,"* not a number out of 100.
- **We publish our own precision and recall.** A fixture corpus with planted traps, run in CI, with a
  ratchet that fails the build on regression.

## What it will be

| Surface | Shape |
|---|---|
| CLI | `npx handrail scan <url> --mode hybrid --report html` |
| Web | Paste a URL, watch findings stream in, share an evidence report |
| CI | GitHub Action: PR comment, SARIF upload, fail-on-threshold, optional fix PR |
| MCP | `scan` / `get_report` tools for Claude Code and other MCP clients |

Deterministic mode is always free and runs fully offline. Hybrid modes add LLM text and vision
judgment under a hard per-scan dollar budget.

## The glass-house rule

An accessibility tool with an inaccessible UI is dead on arrival. Handrail scans its own web UI in
CI on every pull request, and a regression fails the build.

## Development

Requires Node `>=22.12` and pnpm (via corepack).

```bash
pnpm install
pnpm test
```

See [`docs/PLAN.md`](docs/PLAN.md) for the full architecture, phase roadmap, and locked decisions,
and [`AGENTS.md`](AGENTS.md) for the current state of the build.

## License

MIT — see [LICENSE](LICENSE).
