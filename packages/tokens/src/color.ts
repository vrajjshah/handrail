/**
 * sRGB colour maths, to the letter of WCAG 2.x.
 *
 * Handrail's own engine computes contrast ratios to decide whether a page
 * fails 1.4.3. It would be absurd for Handrail's UI to pick its colours by eye,
 * so the tokens go through the same arithmetic — and the numbers this module
 * produces are the ones recorded in `docs/DESIGN.md`.
 *
 * **Tokens are authored as sRGB hex on purpose.** The WCAG relative-luminance
 * formula is defined on sRGB channel values; authoring in `oklch` and
 * converting would mean the recorded ratio describes a value the browser only
 * approximately renders. Hex keeps "what the test computed" and "what ships"
 * the same string.
 */

/** A `#rrggbb` colour. The token layer never uses shorthand or alpha. */
export type Hex = `#${string}`;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

export function parseHex(hex: string): Rgb {
  const value = hex.toLowerCase();
  if (!HEX_PATTERN.test(value)) {
    throw new Error(`expected a #rrggbb colour, got ${JSON.stringify(hex)}`);
  }
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

/** WCAG's sRGB → linear channel transfer. */
function linearize(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two opaque colours, in [1, 21].
 *
 * Rounded to two decimals because that is the precision a recorded ratio is
 * read at, and an unrounded float would make the generated table churn on
 * floating-point noise.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * The three thresholds WCAG 2.2 AA actually defines.
 *
 * `large-text` is ≥24px, or ≥18.66px when bold (1.4.3); `non-text` covers UI
 * component boundaries and meaningful graphics (1.4.11). Nothing in the token
 * set may claim a threshold it does not need — an over-generous requirement
 * that silently passes is not evidence of anything.
 */
export type ContrastRequirement = 'text' | 'large-text' | 'non-text';

export const CONTRAST_THRESHOLDS: Record<ContrastRequirement, number> = {
  text: 4.5,
  'large-text': 3,
  'non-text': 3,
};

export function meetsContrast(
  foreground: string,
  background: string,
  requirement: ContrastRequirement,
): boolean {
  return contrastRatio(foreground, background) >= CONTRAST_THRESHOLDS[requirement];
}

/**
 * Hue angle in degrees, 0–360, from the standard HSL derivation. 0 for a grey.
 *
 * This exists because contrast ratio answers a different question than the one
 * a semantic palette needs answered. Two token colours can each clear 4.5:1
 * against the page and still be *indistinguishable from each other*: contrast
 * is a luminance relationship with a background, not a difference between two
 * foregrounds. The violet AI badge and the teal accent measured 1.09:1 against
 * one another while both passing everything asked of them.
 *
 * Hue separation is the property that actually matters there, and it is only
 * ever a secondary channel — every tier and source badge in this system carries
 * a word, so nothing depends on telling two hues apart.
 */
export function hueAngle(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const chroma = max - Math.min(red, green, blue);
  if (chroma === 0) return 0;

  let sextant: number;
  if (max === red) sextant = ((green - blue) / chroma) % 6;
  else if (max === green) sextant = (blue - red) / chroma + 2;
  else sextant = (red - green) / chroma + 4;

  const degrees = sextant * 60;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** The shorter way around the colour wheel between two hues, 0–180 degrees. */
export function hueDistance(a: string, b: string): number {
  const raw = Math.abs(hueAngle(a) - hueAngle(b));
  return Math.round((raw > 180 ? 360 - raw : raw) * 10) / 10;
}
