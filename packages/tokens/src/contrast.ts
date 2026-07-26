import { CONTRAST_THRESHOLDS, contrastRatio, type ContrastRequirement } from './color.js';
import {
  THEMES,
  type ColorTokenName,
  type ColorTokens,
  type ThemeName,
} from './tokens.js';

/**
 * A pair the design system promises to keep legible, and the WCAG threshold it
 * is promising against.
 *
 * The list is the *specification*. A component may only put a foreground on a
 * background that appears here — if a screen needs a combination this list does
 * not have, the combination gets added and measured, not used on the quiet.
 */
export interface ContrastPair {
  foreground: ColorTokenName;
  background: ColorTokenName;
  requirement: ContrastRequirement;
  /** Where this pair shows up, so a failure names a screen and not just a hex. */
  usage: string;
}

export const REQUIRED_PAIRS: readonly ContrastPair[] = [
  { foreground: 'text', background: 'surface', requirement: 'text', usage: 'body copy on the page' },
  { foreground: 'text', background: 'surface-raised', requirement: 'text', usage: 'body copy in a card' },
  { foreground: 'text', background: 'surface-sunken', requirement: 'text', usage: 'body copy in a well or table header' },
  { foreground: 'text-muted', background: 'surface', requirement: 'text', usage: 'secondary copy, timestamps, hints' },
  { foreground: 'text-muted', background: 'surface-raised', requirement: 'text', usage: 'secondary copy in a card' },
  { foreground: 'text-muted', background: 'surface-sunken', requirement: 'text', usage: 'column labels in a table header' },
  { foreground: 'text-inverse', background: 'surface-inverse', requirement: 'text', usage: 'the footer and the code samples' },

  { foreground: 'accent-text', background: 'surface', requirement: 'text', usage: 'links and quiet buttons' },
  { foreground: 'accent-text', background: 'surface-raised', requirement: 'text', usage: 'links inside a card' },
  { foreground: 'on-accent', background: 'accent', requirement: 'text', usage: 'the primary button label' },
  { foreground: 'on-accent', background: 'accent-hover', requirement: 'text', usage: 'the primary button label, hovered' },

  { foreground: 'border', background: 'surface', requirement: 'non-text', usage: 'separators and card edges' },
  { foreground: 'border', background: 'surface-raised', requirement: 'non-text', usage: 'separators inside a card' },
  { foreground: 'border-strong', background: 'surface', requirement: 'non-text', usage: 'input, checkbox and radio outlines' },
  { foreground: 'border-strong', background: 'surface-raised', requirement: 'non-text', usage: 'input outlines inside a card' },

  { foreground: 'focus-ring', background: 'surface', requirement: 'non-text', usage: 'the focus ring on the page' },
  { foreground: 'focus-ring', background: 'surface-raised', requirement: 'non-text', usage: 'the focus ring inside a card' },
  { foreground: 'focus-ring', background: 'surface-sunken', requirement: 'non-text', usage: 'the focus ring inside a well' },
  { foreground: 'focus-ring-inverse', background: 'surface-inverse', requirement: 'non-text', usage: 'the focus ring on the inverse footer' },

  { foreground: 'violation', background: 'surface', requirement: 'text', usage: 'the violation count and label' },
  { foreground: 'violation', background: 'surface-raised', requirement: 'text', usage: 'the violation label on a finding card' },
  { foreground: 'violation', background: 'violation-surface', requirement: 'text', usage: 'the violation badge' },
  { foreground: 'violation-border', background: 'surface', requirement: 'non-text', usage: 'the violation badge and evidence-overlay edge' },
  { foreground: 'violation-border', background: 'surface-raised', requirement: 'non-text', usage: 'the violation badge on a card' },

  { foreground: 'likely', background: 'surface', requirement: 'text', usage: 'the likely count and label' },
  { foreground: 'likely', background: 'surface-raised', requirement: 'text', usage: 'the likely label on a finding card' },
  { foreground: 'likely', background: 'likely-surface', requirement: 'text', usage: 'the likely badge' },
  { foreground: 'likely-border', background: 'surface', requirement: 'non-text', usage: 'the likely badge edge' },
  { foreground: 'likely-border', background: 'surface-raised', requirement: 'non-text', usage: 'the likely badge on a card' },

  { foreground: 'review', background: 'surface', requirement: 'text', usage: 'the needs-review count and label' },
  { foreground: 'review', background: 'surface-raised', requirement: 'text', usage: 'the needs-review label on a finding card' },
  { foreground: 'review', background: 'review-surface', requirement: 'text', usage: 'the needs-review badge' },
  { foreground: 'review-border', background: 'surface', requirement: 'non-text', usage: 'the needs-review badge edge' },
  { foreground: 'review-border', background: 'surface-raised', requirement: 'non-text', usage: 'the needs-review badge on a card' },

  { foreground: 'pass', background: 'surface', requirement: 'text', usage: 'the pass-verified count and label' },
  { foreground: 'pass', background: 'surface-raised', requirement: 'text', usage: 'the pass label on a criterion row' },
  { foreground: 'pass', background: 'pass-surface', requirement: 'text', usage: 'the pass badge' },
  { foreground: 'pass-border', background: 'surface', requirement: 'non-text', usage: 'the pass badge edge' },
  { foreground: 'pass-border', background: 'surface-raised', requirement: 'non-text', usage: 'the pass badge on a card' },

  { foreground: 'ai', background: 'surface', requirement: 'text', usage: 'the AI-source label' },
  { foreground: 'ai', background: 'surface-raised', requirement: 'text', usage: 'the AI-source label on a finding card' },
  { foreground: 'ai', background: 'ai-surface', requirement: 'text', usage: 'the AI-source badge' },
  { foreground: 'ai-border', background: 'surface', requirement: 'non-text', usage: 'the AI-source badge edge' },
  { foreground: 'ai-border', background: 'surface-raised', requirement: 'non-text', usage: 'the AI-source badge on a card' },
];

export interface ContrastResult extends ContrastPair {
  theme: ThemeName;
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  threshold: number;
  passes: boolean;
}

function measure(theme: ThemeName, tokens: ColorTokens, pair: ContrastPair): ContrastResult {
  const foregroundHex = tokens[pair.foreground];
  const backgroundHex = tokens[pair.background];
  const ratio = contrastRatio(foregroundHex, backgroundHex);
  const threshold = CONTRAST_THRESHOLDS[pair.requirement];
  return {
    ...pair,
    theme,
    foregroundHex,
    backgroundHex,
    ratio,
    threshold,
    passes: ratio >= threshold,
  };
}

/** Every required pair, in both themes, measured. */
export function contrastReport(): ContrastResult[] {
  return (Object.keys(THEMES) as ThemeName[]).flatMap((theme) =>
    REQUIRED_PAIRS.map((pair) => measure(theme, THEMES[theme], pair)),
  );
}

export function failingPairs(): ContrastResult[] {
  return contrastReport().filter((result) => !result.passes);
}

const REQUIREMENT_LABEL: Record<ContrastRequirement, string> = {
  text: 'text 4.5',
  'large-text': 'large text 3.0',
  'non-text': 'non-text 3.0',
};

/**
 * The recorded-ratio table for `docs/DESIGN.md`.
 *
 * Generated rather than written, and diffed by `design-doc.test.ts`, because a
 * hand-typed contrast table is a claim nobody re-checks. This one cannot
 * disagree with the tokens that ship.
 */
export function contrastTable(): string {
  const lines = [
    '| Pair | Requirement | Light | Dark | Used for |',
    '| --- | --- | --- | --- | --- |',
  ];
  const results = contrastReport();
  for (const pair of REQUIRED_PAIRS) {
    const light = results.find(
      (r) => r.theme === 'light' && r.foreground === pair.foreground && r.background === pair.background,
    );
    const dark = results.find(
      (r) => r.theme === 'dark' && r.foreground === pair.foreground && r.background === pair.background,
    );
    if (light === undefined || dark === undefined) continue;
    lines.push(
      `| \`${pair.foreground}\` on \`${pair.background}\` | ${REQUIREMENT_LABEL[pair.requirement]} | ` +
        `${light.ratio.toFixed(2)}:1 | ${dark.ratio.toFixed(2)}:1 | ${pair.usage} |`,
    );
  }
  return lines.join('\n');
}
