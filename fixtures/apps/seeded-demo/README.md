# seeded-demo — Northwind Supper Club

A small React app that is **wrong on purpose**. It is Handrail's recall baseline:
14 planted WCAG 2.2 A/AA defects and 6 traps, all recorded in
[`ground-truth.json`](ground-truth.json).

```bash
pnpm --filter @handrail/fixture-seeded-demo dev   # http://localhost:5178
```

## Rules

1. **Never fix a seeded issue.** If one has to go, remove it from
   `ground-truth.json` in the same commit, with a reason.
2. **Keep `data-gt` and `data-trap` values stable.** The eval harness matches
   findings to ground truth through them, so renaming one silently breaks the
   baseline rather than failing loudly.
3. **Traps are as important as defects.** They are correct code that looks
   defect-adjacent — an empty `alt` on a decorative image, a 24×24 target, text at
   4.54:1. Flagging one is a false positive, and false positives are the thing
   this project is trying not to have.
4. This app is excluded from lint. `eslint-plugin-jsx-a11y` would flag most of it,
   which is the point.

## Why these fourteen

The set is chosen so that no single detection layer can score well alone:

| Layer | Issues | What it proves |
|---|---|---|
| Deterministic (axe) | gt-002, gt-003, gt-004, gt-011 | The rule engine is wired up and the baseline is not measuring nothing. |
| Heuristic | gt-005, gt-007, gt-008, gt-009, gt-014 | Findings that need a real browser: tab order, focus behaviour, reflow, hit areas. |
| LLM text | gt-006, gt-013 | Judgment over content that is syntactically fine. |
| Vision | gt-001, gt-010, gt-012 | Findings only pixels can reveal. |

`gt-001` is the one to look at first. Its alt text is present, fluent, and
describes a completely different photograph. Every rule engine in existence
passes that element.

## Interaction-dependent cases

`gt-014` (keyboard trap) only exists once the newsletter dialog is open — activate
`[data-gt="gt-005"]` first. The crawler reaches it through state exploration
rather than by loading a URL, which is exactly the kind of coverage a
static scan misses.
