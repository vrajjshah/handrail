import { describe, expect, it } from 'vitest';

import { renderThemeCss } from './css.js';
import { FOCUS_RING, SPACING, TARGET_SIZE, TYPE_SCALE } from './scale.js';
import { COLOR_TOKEN_NAMES, DARK, LIGHT } from './tokens.js';

const css = renderThemeCss();

describe('renderThemeCss', () => {
  it('emits every colour token into @theme with its light value', () => {
    for (const name of COLOR_TOKEN_NAMES) {
      expect(css).toContain(`--color-${name}: ${LIGHT[name]};`);
    }
  });

  it('overrides every colour token in the dark theme', () => {
    for (const name of COLOR_TOKEN_NAMES) {
      expect(css).toContain(`--color-${name}: ${DARK[name]};`);
    }
  });

  it('honours the OS preference and an explicit choice, in both directions', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain("[data-theme='dark']");
    // The light override matters as much as the dark one: without it, choosing
    // light on a dark-mode OS would do nothing.
    expect(css).toContain("[data-theme='light']");
  });

  it('defines the focus ring once, globally', () => {
    expect(css).toContain(':focus-visible {');
    expect(css).toContain('outline: var(--focus-ring-width) solid var(--color-focus-ring);');
    expect(css).toContain('outline-offset: var(--focus-ring-offset);');
    expect(css).toContain(`--focus-ring-width: ${FOCUS_RING.width};`);
  });

  it('draws focus as an outline, never a box-shadow', () => {
    // A box-shadow ring disappears in forced-colors mode, which is the one
    // place a focus indicator is most needed.
    expect(css).not.toContain('box-shadow');
  });

  it('hands the ring to the system highlight under forced colors', () => {
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('outline-color: Highlight;');
  });

  it('suppresses motion under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-iteration-count: 1 !important;');
  });

  it('ships the 24px target floor as a token', () => {
    expect(css).toContain(`--size-target-min: ${TARGET_SIZE.min};`);
    expect(TARGET_SIZE.min).toBe('24px');
  });

  it('expresses type and spacing in rem so 200% zoom and reflow work', () => {
    for (const step of Object.values(TYPE_SCALE)) expect(step.size).toMatch(/rem$/);
    for (const [key, value] of Object.entries(SPACING)) {
      if (key === '0') continue;
      expect(value).toMatch(/rem$/);
    }
  });

  it('says it is generated', () => {
    expect(css.startsWith('/*\n * GENERATED FILE — do not edit.')).toBe(true);
  });
});
