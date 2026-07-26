import {
  BREAKPOINTS,
  DURATION,
  FOCUS_RING,
  RADIUS,
  SPACING,
  TARGET_SIZE,
  TYPE_SCALE,
} from './scale.js';
import { COLOR_TOKEN_NAMES, DARK, LIGHT } from './tokens.js';

export const GENERATED_HEADER = [
  '/*',
  ' * GENERATED FILE — do not edit.',
  ' *',
  ' * Source of truth: packages/tokens/src/{tokens,scale}.ts',
  ' * Regenerate:      pnpm --filter @handrail/tokens tokens:build',
  ' *',
  ' * Every colour pair this file can produce is contrast-checked in',
  ' * contrast.test.ts and the measured ratios are recorded in docs/DESIGN.md.',
  ' */',
].join('\n');

function colorVars(tokens: Record<string, string>, indent: string): string {
  return COLOR_TOKEN_NAMES.map((name) => `${indent}--color-${name}: ${tokens[name] ?? ''};`).join('\n');
}

/**
 * Render the Tailwind 4 theme.
 *
 * Tailwind 4 compiles utilities to `var(--color-x)`, so a theme swap is a
 * variable reassignment rather than a second stylesheet — which is what makes
 * the dark theme impossible to forget: there is no `dark:` class to omit on a
 * new component, the value simply changes underneath it.
 */
export function renderThemeCss(): string {
  const blocks: string[] = [GENERATED_HEADER, ''];

  blocks.push('@theme {');
  blocks.push('  /* Colours — light is the default value table. */');
  blocks.push(colorVars(LIGHT, '  '));
  blocks.push('');
  blocks.push('  /* Spacing. */');
  blocks.push(
    Object.entries(SPACING)
      .map(([key, value]) => `  --spacing-${key}: ${value};`)
      .join('\n'),
  );
  blocks.push('');
  blocks.push('  /* Type. Every step is rem, so 200% zoom and a raised base font both work. */');
  blocks.push(
    Object.entries(TYPE_SCALE)
      .map(
        ([key, step]) =>
          `  --text-${key}: ${step.size};\n  --text-${key}--line-height: ${step.lineHeight};`,
      )
      .join('\n'),
  );
  blocks.push('');
  blocks.push('  /* Radius. */');
  blocks.push(
    Object.entries(RADIUS)
      .map(([key, value]) => `  --radius-${key}: ${value};`)
      .join('\n'),
  );
  blocks.push('');
  blocks.push('  /* Breakpoints. 320px is a floor to survive, not a breakpoint to design at. */');
  blocks.push(
    Object.entries(BREAKPOINTS)
      .map(([key, value]) => `  --breakpoint-${key}: ${value};`)
      .join('\n'),
  );
  blocks.push('');
  blocks.push('  /* Motion. Suppressed wholesale under prefers-reduced-motion, below. */');
  blocks.push(
    Object.entries(DURATION)
      .map(([key, value]) => `  --duration-${key}: ${value};`)
      .join('\n'),
  );
  blocks.push('');
  blocks.push('  /* Interactive sizing and the focus ring. */');
  blocks.push(`  --size-target-min: ${TARGET_SIZE.min};`);
  blocks.push(`  --size-target-comfortable: ${TARGET_SIZE.comfortable};`);
  blocks.push(`  --focus-ring-width: ${FOCUS_RING.width};`);
  blocks.push(`  --focus-ring-offset: ${FOCUS_RING.offset};`);
  blocks.push('}');
  blocks.push('');

  blocks.push(
    [
      '/*',
      ' * `dark:` follows the explicit choice, not the OS, because the app has a theme',
      ' * control and a control that some utilities ignore is worse than no control.',
      ' */',
      "@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));",
      '',
      '/* No stored choice: follow the OS. */',
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']) {",
      colorVars(DARK, '    '),
      '  }',
      '}',
      '',
      '/* A stored choice wins over the OS, in both directions. */',
      "[data-theme='dark'] {",
      colorVars(DARK, '  '),
      '}',
      '',
      "[data-theme='light'] {",
      colorVars(LIGHT, '  '),
      '}',
    ].join('\n'),
  );
  blocks.push('');

  blocks.push(
    [
      '@layer base {',
      '  /*',
      '   * The focus ring is defined once, here, for every focusable thing. A',
      '   * component cannot forget it and a component cannot remove it: 2.4.7 is not',
      '   * a per-screen decision.',
      '   */',
      '  :focus-visible {',
      '    outline: var(--focus-ring-width) solid var(--color-focus-ring);',
      '    outline-offset: var(--focus-ring-offset);',
      '  }',
      '',
      '  /* On the inverse footer the same ring would vanish, so the value flips. */',
      '  [data-surface="inverse"] :focus-visible {',
      '    outline-color: var(--color-focus-ring-inverse);',
      '  }',
      '',
      '  /*',
      '   * Forced-colors mode replaces our palette wholesale. Hand the ring back to',
      '   * the system highlight rather than fighting for a colour the user has',
      '   * already overridden.',
      '   */',
      '  @media (forced-colors: active) {',
      '    :focus-visible {',
      '      outline-color: Highlight;',
      '    }',
      '  }',
      '',
      '  /*',
      '   * 2.2.2 and 2.3.3, applied to ourselves. Durations collapse rather than',
      '   * animations being removed, so anything whose completion depends on a',
      '   * transitionend still fires.',
      '   */',
      '  @media (prefers-reduced-motion: reduce) {',
      '    *,',
      '    *::before,',
      '    *::after {',
      '      animation-duration: 0.01ms !important;',
      '      animation-iteration-count: 1 !important;',
      '      transition-duration: 0.01ms !important;',
      '      scroll-behavior: auto !important;',
      '    }',
      '  }',
      '}',
    ].join('\n'),
  );

  return `${blocks.join('\n')}\n`;
}
