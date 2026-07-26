# DESIGN.md — Handrail's own interface

An accessibility tool with an inaccessible interface is dead on arrival.
Reviewers will tab through this app before they read the README, and the first
thing a sceptic does with a scanner is point it at its own homepage. So this
document is not aspirational: it is the specification a screen is built from,
and most of it is enforced by tests, tokens or CI rather than by good intentions.

**Scope.** Everything under `apps/web`, plus the self-contained `report.html`
the engine renders. Both are Handrail surfaces and both are scanned by Handrail.

**Status.** Written as the first slice of Phase 2 (#14), before any component
existed, so that components inherit compliance instead of re-earning it per
screen. Amend it in the same PR as the change it describes.

---

## 1. The rules that are not negotiable

1. **Semantics before ARIA.** A `<button>` before a `<div role="button">`, every
   time. The only ARIA in this codebase is ARIA that names, relates or announces
   something HTML cannot express on its own.
2. **Keyboard first.** Every interactive element is reachable and operable with
   a keyboard alone, in an order that matches the visual one. No positive
   `tabindex`. No mouse-only affordance anywhere.
3. **Focus is always visible.** The ring is defined once, in `theme.css`, on
   `:focus-visible`. A component may not remove it, and nothing in this repo
   sets `outline: none` without replacing it in the same rule.
4. **Colour is never the only channel.** Every tier, status and source badge
   carries a word. Colour is redundant reinforcement, which is also why the
   tokens are contrast-checked rather than merely pretty.
5. **It works at 320 CSS px and at 200% zoom.** Both are criteria our own engine
   checks on other people's sites (1.4.10, 1.4.4). Layout is `rem`-based and
   reflows; nothing scrolls in two directions.
6. **Motion is optional.** Every transition collapses under
   `prefers-reduced-motion: reduce`, globally, in the base layer.
7. **The interface tells the truth.** No spinner that implies progress it cannot
   measure, no "0 issues found" where the honest answer is "38 of 55 criteria
   evaluated". Honest coverage is the product; the UI does not get to round it up.

---

## 2. Browser and platform matrix

| Tier | Targets | What it means |
| --- | --- | --- |
| Supported | Evergreen Chrome, Edge, Firefox, Safari (current and current−1), on macOS, Windows and Linux | Bugs here are release-blocking. |
| Supported | iOS Safari and Android Chrome, current | The report is read on phones; the scan form is used on them. |
| Best effort | Anything else evergreen | Fix if cheap, no gate. |
| Unsupported | IE, and any browser without CSS custom properties | The token system is CSS variables end to end. |

**Assistive technology.** The pass that counts at each phase gate is manual:
NVDA + Firefox on Windows, VoiceOver + Safari on macOS (#26). Automation stops
where screen readers begin — that is this project's own thesis, so the UI does
not get to claim an SR pass it has not done by hand.

**Forced colors.** Windows High Contrast is a supported mode, not a nice-to-have.
Anything that conveys meaning with a background colour also conveys it with text
or a border, because forced-colors replaces the palette wholesale.

---

## 3. Viewport, zoom and preference matrix

Every screen is checked against all of these before its PR. They are the same
conditions `@handrail/engine` puts other sites through.

| Condition | How | What must hold |
| --- | --- | --- |
| 320 × 800 (`reflow-320`) | Devtools responsive, or the app's own scan | No horizontal scrolling of content. No two-dimensional scroll except for data tables and code blocks, which scroll inside their own container. |
| 390 × 844 (`mobile`) | Devtools | Touch targets ≥ 24 px with spacing; primary actions 44 px. |
| 1440 × 900 (`desktop`) | Default | Content column caps at `--breakpoint-xl`; nothing stretches to a 30-word measure. |
| 200% zoom | Browser zoom at 1280 × 1024 | Equivalent to 640 px wide: same reflow rules apply. |
| 400% zoom | Browser zoom at 1280 × 1024 | Equivalent to 320 px: this is 1.4.10's actual test. |
| Text-only 200% | Firefox, font size only | No clipped or overlapped text. This is what catches `px` line-heights. |
| `prefers-reduced-motion` | OS setting or devtools emulation | No animation longer than a frame; the progress timeline still updates. |
| `prefers-color-scheme: dark` | OS setting or devtools emulation | Dark tokens apply; contrast holds (§5). |
| `forced-colors: active` | Windows HC, or Edge devtools emulation | Focus ring visible; every badge legible; no meaning lost. |

---

## 4. Tokens

Values live in `@handrail/tokens` and are compiled into `theme.css` as a
Tailwind 4 `@theme` block. **A component uses token names only** — no hex
literals, no arbitrary `[13px]` values. If a screen needs a value the scale does
not have, the scale gains a step in the same PR and everything else inherits it.

Regenerate after any change to `packages/tokens/src/tokens.ts` or `scale.ts`:

```bash
pnpm --filter @handrail/tokens tokens:build
```

`generated.test.ts` fails if `theme.css` or the generated sections of this
document have drifted from the source, so the regeneration lands in the same PR
as the change that caused it.

### 4.1 Colour tokens

Names are roles, not values. The dark theme is a different value table under the
same names, which is why there is no `dark:` class to forget on a new component.

<!-- BEGIN GENERATED: tokens -->

| Token | Light | Dark |
| --- | --- | --- |
| `--color-surface` | `#ffffff` | `#0e141b` |
| `--color-surface-raised` | `#f6f8fa` | `#161e27` |
| `--color-surface-sunken` | `#eceff3` | `#080c11` |
| `--color-surface-inverse` | `#111b24` | `#e9eef4` |
| `--color-text` | `#101720` | `#e9eef4` |
| `--color-text-muted` | `#54606e` | `#a0adbc` |
| `--color-text-inverse` | `#f4f7fa` | `#101720` |
| `--color-border` | `#858f9c` | `#626e7c` |
| `--color-border-strong` | `#616d7b` | `#8e9aa8` |
| `--color-accent` | `#0b5560` | `#5bc6cf` |
| `--color-accent-hover` | `#083f47` | `#8adae0` |
| `--color-accent-text` | `#0b5560` | `#5bc6cf` |
| `--color-on-accent` | `#ffffff` | `#062026` |
| `--color-focus-ring` | `#0b1220` | `#f4f7fa` |
| `--color-focus-ring-inverse` | `#f4f7fa` | `#0b1220` |
| `--color-violation` | `#a11a13` | `#ff9b91` |
| `--color-violation-surface` | `#fdeceb` | `#2c1513` |
| `--color-violation-border` | `#c65c55` | `#a2504a` |
| `--color-likely` | `#7a5406` | `#f0c069` |
| `--color-likely-surface` | `#fdf3e6` | `#2a2010` |
| `--color-likely-border` | `#a37519` | `#977629` |
| `--color-review` | `#1b4f9b` | `#8fb6f0` |
| `--color-review-surface` | `#eaf1fc` | `#131f31` |
| `--color-review-border` | `#5a86c4` | `#4a6d9e` |
| `--color-pass` | `#146239` | `#6ec994` |
| `--color-pass-surface` | `#e7f4ec` | `#0f2418` |
| `--color-pass-border` | `#4e9268` | `#3f7d5b` |
| `--color-ai` | `#6b2fb5` | `#c3a2f0` |
| `--color-ai-surface` | `#f3ecfc` | `#1e1630` |
| `--color-ai-border` | `#9268cc` | `#7b62a8` |

<!-- END GENERATED: tokens -->

### 4.2 Scales

<!-- BEGIN GENERATED: scales -->

| Scale | Steps |
| --- | --- |
| Spacing (`--spacing-*`) | `0` 0rem · `1` 0.25rem · `2` 0.5rem · `3` 0.75rem · `4` 1rem · `6` 1.5rem · `8` 2rem · `12` 3rem · `16` 4rem · `px` 0.0625rem |
| Type (`--text-*`) | `display` 2.25rem/1.15 · `title` 1.75rem/1.2 · `heading` 1.375rem/1.3 · `subheading` 1.125rem/1.4 · `body` 1rem/1.55 · `small` 0.875rem/1.5 · `code` 0.9375rem/1.6 |
| Radius (`--radius-*`) | `none` 0rem · `sm` 0.25rem · `md` 0.5rem · `lg` 0.75rem · `full` 9999px |
| Duration (`--duration-*`) | `fast` 120ms · `normal` 200ms · `slow` 320ms |
| Target size | `--size-target-min` 24px · `--size-target-comfortable` 44px |

<!-- END GENERATED: scales -->

Type steps stop at `small` (0.875rem). There is deliberately no 12px caption
step: it is the most common way an otherwise careful interface becomes
unreadable, and Handrail does not get to ship one.

---

## 5. Contrast, measured

Every pair below is computed with the WCAG relative-luminance formula — the same
arithmetic `@handrail/engine` applies to other people's pages — by
`packages/tokens/src/contrast.ts`, and asserted by `contrast.test.ts`. The
requirement column is the threshold that actually applies: 4.5 for body text
(1.4.3), 3.0 for UI component boundaries and meaningful graphics (1.4.11).

**There is no decorative-only colour token.** `border` is subtle but still
clears 3:1, so there is no escape hatch to hide a low-contrast value behind.

<!-- BEGIN GENERATED: contrast -->

| Pair | Requirement | Light | Dark | Used for |
| --- | --- | --- | --- | --- |
| `text` on `surface` | text 4.5 | 18.02:1 | 15.87:1 | body copy on the page |
| `text` on `surface-raised` | text 4.5 | 16.93:1 | 14.41:1 | body copy in a card |
| `text` on `surface-sunken` | text 4.5 | 15.62:1 | 16.81:1 | body copy in a well or table header |
| `text-muted` on `surface` | text 4.5 | 6.41:1 | 8.11:1 | secondary copy, timestamps, hints |
| `text-muted` on `surface-raised` | text 4.5 | 6.02:1 | 7.36:1 | secondary copy in a card |
| `text-muted` on `surface-sunken` | text 4.5 | 5.56:1 | 8.59:1 | column labels in a table header |
| `text-inverse` on `surface-inverse` | text 4.5 | 16.19:1 | 15.45:1 | the footer and the code samples |
| `accent-text` on `surface` | text 4.5 | 8.46:1 | 9.19:1 | links and quiet buttons |
| `accent-text` on `surface-raised` | text 4.5 | 7.95:1 | 8.34:1 | links inside a card |
| `on-accent` on `accent` | text 4.5 | 8.46:1 | 8.39:1 | the primary button label |
| `on-accent` on `accent-hover` | text 4.5 | 11.59:1 | 10.61:1 | the primary button label, hovered |
| `border` on `surface` | non-text 3.0 | 3.28:1 | 3.56:1 | separators and card edges |
| `border` on `surface-raised` | non-text 3.0 | 3.08:1 | 3.23:1 | separators inside a card |
| `border-strong` on `surface` | non-text 3.0 | 5.27:1 | 6.47:1 | input, checkbox and radio outlines |
| `border-strong` on `surface-raised` | non-text 3.0 | 4.95:1 | 5.87:1 | input outlines inside a card |
| `focus-ring` on `surface` | non-text 3.0 | 18.72:1 | 17.21:1 | the focus ring on the page |
| `focus-ring` on `surface-raised` | non-text 3.0 | 17.59:1 | 15.64:1 | the focus ring inside a card |
| `focus-ring` on `surface-sunken` | non-text 3.0 | 16.23:1 | 18.24:1 | the focus ring inside a well |
| `focus-ring-inverse` on `surface-inverse` | non-text 3.0 | 16.19:1 | 16.05:1 | the focus ring on the inverse footer |
| `violation` on `surface` | text 4.5 | 7.86:1 | 9.12:1 | the violation count and label |
| `violation` on `surface-raised` | text 4.5 | 7.38:1 | 8.29:1 | the violation label on a finding card |
| `violation` on `violation-surface` | text 4.5 | 6.88:1 | 8.46:1 | the violation badge |
| `violation-border` on `surface` | non-text 3.0 | 4.15:1 | 3.33:1 | the violation badge and evidence-overlay edge |
| `violation-border` on `surface-raised` | non-text 3.0 | 3.90:1 | 3.03:1 | the violation badge on a card |
| `likely` on `surface` | text 4.5 | 6.78:1 | 10.97:1 | the likely count and label |
| `likely` on `surface-raised` | text 4.5 | 6.37:1 | 9.97:1 | the likely label on a finding card |
| `likely` on `likely-surface` | text 4.5 | 6.18:1 | 9.48:1 | the likely badge |
| `likely-border` on `surface` | non-text 3.0 | 4.10:1 | 4.35:1 | the likely badge edge |
| `likely-border` on `surface-raised` | non-text 3.0 | 3.86:1 | 3.95:1 | the likely badge on a card |
| `review` on `surface` | text 4.5 | 7.96:1 | 8.92:1 | the needs-review count and label |
| `review` on `surface-raised` | text 4.5 | 7.48:1 | 8.10:1 | the needs-review label on a finding card |
| `review` on `review-surface` | text 4.5 | 7.01:1 | 7.98:1 | the needs-review badge |
| `review-border` on `surface` | non-text 3.0 | 3.72:1 | 3.50:1 | the needs-review badge edge |
| `review-border` on `surface-raised` | non-text 3.0 | 3.50:1 | 3.18:1 | the needs-review badge on a card |
| `pass` on `surface` | text 4.5 | 7.41:1 | 9.21:1 | the pass-verified count and label |
| `pass` on `surface-raised` | text 4.5 | 6.96:1 | 8.36:1 | the pass label on a criterion row |
| `pass` on `pass-surface` | text 4.5 | 6.54:1 | 8.12:1 | the pass badge |
| `pass-border` on `surface` | non-text 3.0 | 3.73:1 | 3.79:1 | the pass badge edge |
| `pass-border` on `surface-raised` | non-text 3.0 | 3.50:1 | 3.44:1 | the pass badge on a card |
| `ai` on `surface` | text 4.5 | 7.78:1 | 8.59:1 | the AI-source label |
| `ai` on `surface-raised` | text 4.5 | 7.31:1 | 7.80:1 | the AI-source label on a finding card |
| `ai` on `ai-surface` | text 4.5 | 6.75:1 | 8.04:1 | the AI-source badge |
| `ai-border` on `surface` | non-text 3.0 | 4.14:1 | 3.66:1 | the AI-source badge edge |
| `ai-border` on `surface-raised` | non-text 3.0 | 3.89:1 | 3.33:1 | the AI-source badge on a card |

<!-- END GENERATED: contrast -->

A pair not in this table may not be used. Adding a combination means adding it
to `REQUIRED_PAIRS` and measuring it, which is a one-line change and a green or
red test — not a judgement call.

---

## 6. Focus and keyboard

### 6.1 The ring

3 px solid `--color-focus-ring`, offset 2 px, drawn with `outline`.

- **`outline`, never `box-shadow`.** A shadow ring vanishes in forced-colors
  mode, which is the one place a focus indicator is most needed.
- **The offset is load-bearing.** It makes the ring sit on the surface behind
  the control, so the ring only has to contrast with the page — not with every
  button fill. That is why §5 measures `focus-ring` against surfaces only.
- On `[data-surface="inverse"]` the value flips to `--color-focus-ring-inverse`.
- Under forced colors the ring becomes `Highlight` and stops fighting the user's
  own palette.

### 6.2 Order and traps

- DOM order is reading order. Layout never reorders interactive content
  (`order`, `row-reverse` and friends are for presentation only, and not across
  focusable elements).
- No positive `tabindex`. `tabindex="-1"` is for programmatic focus targets only
  (the `<main>` landing spot, a dialog's initial focus).
- A dialog traps focus while open and restores focus to its trigger on close.
  That is the *only* sanctioned trap. React Aria Components' `Modal` does both;
  do not hand-roll it.

### 6.3 Keys, per pattern

| Pattern | Keys | Component |
| --- | --- | --- |
| Button | <kbd>Enter</kbd>, <kbd>Space</kbd> | `Button` |
| Link | <kbd>Enter</kbd> | `<a>` / `Link` |
| Text field | typing; <kbd>Enter</kbd> submits the form | `TextField` |
| Disclosure | <kbd>Enter</kbd>, <kbd>Space</kbd> toggles; state on the trigger | `Disclosure` |
| Tabs | <kbd>←</kbd>/<kbd>→</kbd> moves, <kbd>Home</kbd>/<kbd>End</kbd> jumps; panel is the next stop | `Tabs` |
| Menu | <kbd>↑</kbd>/<kbd>↓</kbd>, type-ahead, <kbd>Esc</kbd> closes and restores focus | `MenuTrigger` |
| Dialog | trap while open, <kbd>Esc</kbd> closes, focus returns to trigger | `Modal` + `Dialog` |
| Table | one tab stop; arrow keys move between rows when rows are interactive | `Table` |
| Skip link | first tab stop on every page; visible when focused | `apps/web` shell |

**Do not implement any of these by hand.** `apps/web` uses React Aria Components
for exactly this reason: keyboard, focus management and ARIA wiring are solved
upstream, by people who test against real screen readers. A hand-rolled dropdown
is a regression waiting to be found by a reviewer.

---

## 7. Structure and ARIA

### 7.1 Landmarks — every page, exactly once

```
<header>                 → banner
  <nav aria-label="Main">
<main id="main">         → main, tabindex="-1", the skip-link target
<footer>                 → contentinfo, data-surface="inverse"
```

Sections that a reader would navigate to get `<section aria-labelledby="…">`
pointing at their own heading. A `<section>` without an accessible name is a
`<div>`; use the `<div>`.

### 7.2 Headings

One `<h1>` per page, and it names the page rather than the product ("Scan
results for example.com", not "Handrail"). Levels never skip — the outline is
checked by our own `ai.heading-outline` check, and failing it on our own site
would be embarrassing in a specific and deserved way.

### 7.3 Names and descriptions

- Every control has a visible text label. Icon-only buttons are permitted only
  where the icon is universally understood *and* the button carries
  `aria-label`; the label repeats the visible text when there is one.
- Link text stands alone: "the evidence report", never "click here" — the
  seeded fixture's `gt-006` is literally a "Click here" link, so shipping one
  would be self-parody.
- Form errors are associated with `aria-describedby`, are text (not colour), and
  say what to do next (3.3.3), not merely that something is wrong.

### 7.4 Live regions

Streaming findings are the one genuinely hard part of this UI. The rule:

- **One polite status region per scan screen**, announcing *phase transitions
  and terminal state only*: "Capturing pages", "Judging text", "Scan complete:
  7 findings across 55 criteria".
- **The findings list is not a live region.** A scan that streams thirty
  findings would produce thirty interruptions, and a screen-reader user would
  learn nothing they could act on. The list updates silently; the count in the
  status region is what changes.
- **Errors use `role="alert"`** (assertive) and nothing else does.
- `aria-busy` on the results region while the scan runs.

---

## 8. Screens

Enough detail to build from. Where a screen is not yet built, this is the spec
the issue implements.

### 8.1 Shell (#15)

- Skip link, first in the DOM, visually hidden until focused, target `#main`.
- Banner: product name as a link home, main nav, theme control.
- The theme control is a three-state group — System / Light / Dark — because
  "follow the OS" is a real choice and a two-state toggle silently removes it.
  Persist to `localStorage`, apply as `data-theme` on `<html>`, default to
  System. No flash: the stored value is applied by an inline script before paint.
- `<main id="main" tabindex="-1">` so the skip link lands somewhere focusable.
- Footer on `data-surface="inverse"`: licence, repo link, version, and the
  honest-coverage disclaimer.
- Content column: `max-width: var(--breakpoint-lg)`, gutters `--spacing-4`,
  rising to `--spacing-8` above `md`.

### 8.2 Submit a scan (#23)

- `<h1>Scan a site for accessibility problems</h1>`, one `TextField` (`type=url`,
  `inputMode=url`, `autocomplete=url`), one primary `Button`.
- Validation is server-truth: the client checks non-empty and http(s) shape; the
  server's SSRF verdict is authoritative and its message is what the user sees.
  A rejected URL is a `role="alert"` message under the field, focus moved to
  the field, and the typed value preserved.
- Rate-limit rejection (429) is not an error state — it is an explained wait,
  with the retry time in words.
- Below the fold: what a scan does, what it costs (nothing), what it will not do
  (bypass a login, defeat bot protection), and a link to the honest-coverage
  explanation.

### 8.3 Watch a scan (#23)

- `<h1>` names the target. The phase timeline is an ordered list, one item per
  phase, each with a state: pending / running / done / failed, expressed as text
  plus icon, never colour alone.
- Findings stream into a list under a heading that carries the running count.
  New items append; nothing reorders under the reader (a list that re-sorts
  while a screen reader is in it is a maze).
- Reconnect is invisible: `Last-Event-ID` replay means the UI never shows a gap
  and never double-counts. If the stream cannot be resumed, say so plainly and
  offer a reload — do not silently show a stale timeline.
- Degradation is surfaced the moment it arrives, in its own callout: "The model
  was unreachable, so text judgment did not run. Deterministic results are
  complete." That is trust invariant 1 made visible.

### 8.4 Read the report (#23)

- Grouped by WCAG principle, then criterion. Each finding: tier badge, source
  badge (deterministic / AI + verifier), criterion, element, evidence,
  remediation.
- The headline is the coverage sentence, not a score. **No number out of 100.**
- Screenshot evidence opens in a `Modal` with the bbox overlay described in
  text ("highlighted region: the submit button, 118 × 18 px"), because an
  overlay is a visual affordance and the evidence must survive without it.
- Filters (tier, source, criterion) are checkboxes in a labelled group, applied
  live; the result count is announced in the polite status region.

---

## 9. States

Every data surface defines all five. A screen that only has a success state is
not finished.

| State | Pattern |
| --- | --- |
| **Loading** | Skeleton blocks that match the eventual layout, `aria-busy="true"` on the region, and a polite "Loading …" announcement. No spinner-only screens; no fake progress bars. |
| **Empty (nothing yet)** | Explain what will appear here and the one action that fills it. Never an empty box with a shrug. |
| **Empty (nothing found)** | Say what was examined, not just what was not found: "No violations in the 38 criteria we can evaluate automatically. 17 criteria need a human — checklist below." |
| **Partial / degraded** | A callout naming what did not run and why, above the results, plus the coverage statement. Partial results are the design, not a failure. |
| **Error** | `role="alert"`, plain language, the thing to do next, and the correlation id in small text so a bug report can be traced. Never a raw stack trace, never a bare status code. |

---

## 10. Copy

- **Plain, specific, second person.** "Paste a URL and we'll scan it." Not
  "Utilise the input field below."
- **Say the number.** "7 findings across 3 criteria", not "several issues".
- **Never overstate certainty.** A `likely` finding says "likely" in the copy
  as well as in the badge. `needs-review` is "needs a human", not "possible
  issue". The tier vocabulary is fixed: **violation / likely / needs review**.
- **Never blame the user.** "That URL didn't resolve" beats "Invalid input".
- **Sentence case** for headings, buttons and labels. No exclamation marks.
- **Abbreviations get expanded once per page**: WCAG, SC, AA. `<abbr>` only
  where the expansion genuinely helps; it announces poorly when overused.
- **Numbers**: digits always (7, not seven). Money to four decimals ($0.0000)
  because a scan can genuinely cost fractions of a cent.

---

## 11. How a UI slice is verified

The loop, per the plan's §Design system, and the answer to "did you check?":

1. Build the screen from this document.
2. Run the dev server in the browser preview; screenshot it.
3. **Tab through it end to end.** Every stop visible, order matches the page,
   nothing unreachable, nothing trapped.
4. Check it at 320 px, at 200% zoom, in dark mode, and with reduced motion.
5. Run the app's own deterministic scan against it (#24 makes this a CI gate) —
   `kbd.walk`, `resp.reflow-320` and axe, on ourselves.
6. `pnpm lint` with strict `eslint-plugin-jsx-a11y` — a lint failure here is a
   design failure, not a style nit.
7. Screen-reader pass at the phase gate (#26), by hand.

A slice is done when all seven have happened, not when it looks right.
