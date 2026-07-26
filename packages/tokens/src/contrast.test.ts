import { describe, expect, it } from 'vitest';

import { hueDistance } from './color.js';
import { REQUIRED_PAIRS, contrastReport, contrastTable, failingPairs } from './contrast.js';
import { COLOR_TOKEN_NAMES, DARK, LIGHT } from './tokens.js';

describe('the token palette', () => {
  // The acceptance criterion for this slice, as a test rather than a promise.
  it('meets every declared contrast requirement in both themes', () => {
    const failures = failingPairs().map(
      (result) =>
        `${result.theme}: ${result.foreground} (${result.foregroundHex}) on ${result.background} ` +
        `(${result.backgroundHex}) is ${result.ratio.toFixed(2)}:1, needs ${String(result.threshold)}:1`,
    );
    expect(failures).toEqual([]);
  });

  it('measures every pair in both themes', () => {
    expect(contrastReport()).toHaveLength(REQUIRED_PAIRS.length * 2);
  });

  it('defines the same token names in both themes', () => {
    expect(Object.keys(LIGHT).sort()).toEqual([...COLOR_TOKEN_NAMES].sort());
    expect(Object.keys(DARK).sort()).toEqual([...COLOR_TOKEN_NAMES].sort());
  });

  it('uses #rrggbb throughout, which is what the contrast maths is defined on', () => {
    for (const tokens of [LIGHT, DARK]) {
      for (const name of COLOR_TOKEN_NAMES) {
        expect(tokens[name]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('declares a requirement for every text colour it ships', () => {
    // A token used as a foreground somewhere but never measured is exactly the
    // hole this list exists to close, so the foregrounds are asserted by name.
    const foregrounds = new Set(REQUIRED_PAIRS.map((pair) => pair.foreground));
    for (const name of [
      'text',
      'text-muted',
      'text-inverse',
      'accent-text',
      'on-accent',
      'violation',
      'likely',
      'review',
      'pass',
      'ai',
    ] as const) {
      expect(foregrounds).toContain(name);
    }
  });

  it('keeps the tier colours distinguishable from each other, not just from the page', () => {
    // Four tiers that each pass against the background can still be four shades
    // of the same thing — contrast measures legibility *against a background*
    // and says nothing about two foregrounds. Hue separation is the property
    // that applies, and it is a secondary channel only: every badge in this
    // system also carries the word.
    const tiers = ['violation', 'likely', 'review', 'pass'] as const;
    for (const theme of [LIGHT, DARK]) {
      for (const [index, a] of tiers.entries()) {
        for (const b of tiers.slice(index + 1)) {
          expect(hueDistance(theme[a], theme[b])).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  it('separates the AI badge from the deterministic accent', () => {
    // Trust invariant 3 is about provenance. If AI-sourced and deterministic
    // findings look alike, the tier ceilings are invisible to the reader.
    // These two measure 1.09:1 against each other and both pass every contrast
    // requirement, which is exactly why this asserts hue rather than ratio.
    expect(hueDistance(LIGHT.ai, LIGHT.accent)).toBeGreaterThanOrEqual(45);
    expect(hueDistance(DARK.ai, DARK.accent)).toBeGreaterThanOrEqual(45);
  });
});

describe('contrastTable', () => {
  it('records a row per pair with both themes measured', () => {
    const table = contrastTable();
    const rows = table.split('\n').slice(2);
    expect(rows).toHaveLength(REQUIRED_PAIRS.length);
    for (const row of rows) {
      expect(row).toMatch(/\| \d+\.\d{2}:1 \| \d+\.\d{2}:1 \|/);
    }
  });

  it('names the tokens, not the hexes, so a value change does not rewrite the table', () => {
    expect(contrastTable()).toContain('`text` on `surface`');
  });
});
