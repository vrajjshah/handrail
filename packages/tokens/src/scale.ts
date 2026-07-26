/**
 * The non-colour half of the token set: space, type, radius, motion, and the
 * two numbers that decide whether a control is operable.
 *
 * Everything is expressed in `rem`. That is not a style preference — 1.4.4
 * (Resize text) and 1.4.10 (Reflow) are the criteria our own engine checks, and
 * a layout pinned in `px` fails both the moment someone raises their default
 * font size. The one deliberate exception is {@link TARGET_SIZE}, because 2.5.8
 * is specified in CSS pixels.
 */

/**
 * Spacing scale, in rem. A 4px base at the default root size.
 *
 * Deliberately short. Nine steps is enough to build every Phase 2 screen, and a
 * scale nobody can hold in their head gets bypassed with arbitrary values.
 */
export const SPACING: Record<string, string> = {
  '0': '0rem',
  px: '0.0625rem',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '6': '1.5rem',
  '8': '2rem',
  '12': '3rem',
  '16': '4rem',
};

export interface TypeStep {
  size: string;
  lineHeight: string;
  /** Where this step is used, so a new screen picks a step instead of a number. */
  usage: string;
}

/**
 * Type scale. `body` is 1rem and everything else is a ratio of it, so the whole
 * page scales with the user's own setting rather than resisting it.
 *
 * There is no step below 0.875rem. A 12px caption is the most common way an
 * otherwise careful UI becomes unreadable, and Handrail does not get to ship one.
 */
export const TYPE_SCALE: Record<string, TypeStep> = {
  'display': { size: '2.25rem', lineHeight: '1.15', usage: 'the one h1 on the landing screen' },
  'title': { size: '1.75rem', lineHeight: '1.2', usage: 'page h1' },
  'heading': { size: '1.375rem', lineHeight: '1.3', usage: 'section h2' },
  'subheading': { size: '1.125rem', lineHeight: '1.4', usage: 'card h3, finding titles' },
  'body': { size: '1rem', lineHeight: '1.55', usage: 'everything by default' },
  'small': { size: '0.875rem', lineHeight: '1.5', usage: 'metadata, badge text, table cells' },
  'code': { size: '0.9375rem', lineHeight: '1.6', usage: 'DOM excerpts and remediation snippets' },
};

export const RADIUS: Record<string, string> = {
  none: '0rem',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
};

/**
 * Interactive target sizing, in CSS pixels because 2.5.8 is.
 *
 * `min` is the 24×24 floor the criterion sets and our own `ptr.target-size`
 * check enforces on other people's sites. `comfortable` is the 44×44 that
 * 2.5.5 (AAA, out of scope) asks for and that every primary control here uses
 * anyway — the floor is a floor, not a target.
 */
export const TARGET_SIZE = {
  min: '24px',
  comfortable: '44px',
} as const;

/**
 * The focus ring.
 *
 * Drawn as an `outline` with an offset, never a `box-shadow`: an outline
 * survives `forced-colors` mode, and the offset means the ring is measured
 * against the surface behind the control rather than the control's own fill.
 * That is why `focus-ring` only has to contrast with the surfaces in
 * `REQUIRED_PAIRS` and not with every button colour.
 */
export const FOCUS_RING = {
  width: '3px',
  offset: '2px',
} as const;

/**
 * Motion durations. Every one of these is suppressed under
 * `prefers-reduced-motion: reduce` by the base layer in `theme.css`.
 */
export const DURATION: Record<string, string> = {
  fast: '120ms',
  normal: '200ms',
  slow: '320ms',
};

/**
 * The reflow breakpoint that matters. 320 CSS px is 1.4.10's floor and the
 * width our own `resp.reflow-320` check uses; `md` and `lg` exist for layout
 * that improves above it, never for layout that is required below it.
 */
export const BREAKPOINTS: Record<string, string> = {
  sm: '30rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
};
