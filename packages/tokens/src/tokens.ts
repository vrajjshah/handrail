import type { Hex } from './color.js';

/**
 * The semantic token set. Every colour a Handrail surface may use is named here
 * and nowhere else.
 *
 * Names are *roles*, not values: a component asks for `border-strong`, never
 * for "slate 400". That is what lets the dark theme be a different value table
 * under the same names, and what makes the contrast requirements in
 * `contrast.ts` a complete statement about the system rather than a spot check.
 */
export const COLOR_TOKEN_NAMES = [
  // Backgrounds, from the page up.
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-inverse',

  // Foregrounds.
  'text',
  'text-muted',
  'text-inverse',

  // Boundaries. `border` separates; `border-strong` is a real UI component
  // boundary (a field outline, a checkbox edge) and carries 1.4.11 weight.
  'border',
  'border-strong',

  // Brand.
  'accent',
  'accent-hover',
  'accent-text',
  'on-accent',

  // Focus. Two, because a ring drawn on a dark surface is a different colour
  // problem from one drawn on the page.
  'focus-ring',
  'focus-ring-inverse',

  // Finding tiers — the product's own vocabulary. `review` is `needs-review`.
  'violation',
  'violation-surface',
  'violation-border',
  'likely',
  'likely-surface',
  'likely-border',
  'review',
  'review-surface',
  'review-border',
  'pass',
  'pass-surface',
  'pass-border',

  // Provenance badges. Deterministic evidence and AI judgment must never look
  // alike; the tier ceilings mean nothing if the source is not visible.
  'ai',
  'ai-surface',
  'ai-border',
] as const;

export type ColorTokenName = (typeof COLOR_TOKEN_NAMES)[number];

export type ColorTokens = Record<ColorTokenName, Hex>;

export type ThemeName = 'light' | 'dark';

/**
 * Light theme.
 *
 * Values are chosen to satisfy `REQUIRED_PAIRS`; the recorded ratios in
 * `docs/DESIGN.md` are generated from them. Changing one of these hexes without
 * re-running the generator fails `contrast.test.ts`, which is the point.
 */
export const LIGHT: ColorTokens = {
  surface: '#ffffff',
  'surface-raised': '#f6f8fa',
  'surface-sunken': '#eceff3',
  'surface-inverse': '#111b24',

  text: '#101720',
  'text-muted': '#54606e',
  'text-inverse': '#f4f7fa',

  border: '#858f9c',
  'border-strong': '#616d7b',

  accent: '#0b5560',
  'accent-hover': '#083f47',
  'accent-text': '#0b5560',
  'on-accent': '#ffffff',

  'focus-ring': '#0b1220',
  'focus-ring-inverse': '#f4f7fa',

  violation: '#a11a13',
  'violation-surface': '#fdeceb',
  'violation-border': '#c65c55',
  likely: '#7a5406',
  'likely-surface': '#fdf3e6',
  'likely-border': '#a37519',
  review: '#1b4f9b',
  'review-surface': '#eaf1fc',
  'review-border': '#5a86c4',
  pass: '#146239',
  'pass-surface': '#e7f4ec',
  'pass-border': '#4e9268',

  ai: '#6b2fb5',
  'ai-surface': '#f3ecfc',
  'ai-border': '#9268cc',
};

/**
 * Dark theme.
 *
 * Not an inversion — an inverted palette produces halation on saturated hues.
 * The tier hues are lifted and desaturated so they still read as red/amber/blue/
 * green at 4.5:1 against a near-black page.
 */
export const DARK: ColorTokens = {
  surface: '#0e141b',
  'surface-raised': '#161e27',
  'surface-sunken': '#080c11',
  'surface-inverse': '#e9eef4',

  text: '#e9eef4',
  'text-muted': '#a0adbc',
  'text-inverse': '#101720',

  border: '#626e7c',
  'border-strong': '#8e9aa8',

  accent: '#5bc6cf',
  'accent-hover': '#8adae0',
  'accent-text': '#5bc6cf',
  'on-accent': '#062026',

  'focus-ring': '#f4f7fa',
  'focus-ring-inverse': '#0b1220',

  violation: '#ff9b91',
  'violation-surface': '#2c1513',
  'violation-border': '#a2504a',
  likely: '#f0c069',
  'likely-surface': '#2a2010',
  'likely-border': '#977629',
  review: '#8fb6f0',
  'review-surface': '#131f31',
  'review-border': '#4a6d9e',
  pass: '#6ec994',
  'pass-surface': '#0f2418',
  'pass-border': '#3f7d5b',

  ai: '#c3a2f0',
  'ai-surface': '#1e1630',
  'ai-border': '#7b62a8',
};

export const THEMES: Record<ThemeName, ColorTokens> = { light: LIGHT, dark: DARK };
