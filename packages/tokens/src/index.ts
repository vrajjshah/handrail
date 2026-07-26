/**
 * `@handrail/tokens` — the design system's values, and the arithmetic that
 * keeps them honest.
 *
 * The glass-house rule says Handrail's own UI passes Handrail's own scan. This
 * package is how that is cheap rather than heroic: colour pairs are measured
 * with the same WCAG formula the engine applies to other people's sites, the
 * focus ring and the reduced-motion suppression are defined once in
 * `theme.css`, and `docs/DESIGN.md` records the measured ratios rather than
 * claiming them. A screen that only uses these names starts compliant.
 *
 * It depends on nothing. `@handrail/schemas` sits at the bottom of the runtime
 * layering; this sits beside it, in the presentation layer, and is imported by
 * surfaces only.
 */
export * from './color.js';
export * from './tokens.js';
export * from './contrast.js';
export * from './scale.js';
export * from './css.js';
export * from './design-doc.js';
export * from './paths.js';
