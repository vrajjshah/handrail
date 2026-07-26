import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { renderThemeCss } from './css.js';
import { GENERATED_SECTIONS, readSection } from './design-doc.js';
import { DESIGN_DOC_PATH, THEME_CSS_PATH } from './paths.js';

/**
 * The committed artifacts must match the source of truth.
 *
 * Note what this file does *not* import: `scripts/build-tokens.ts`. That module
 * ends in `await main()`, so importing it — even only for a path constant —
 * would rewrite both files before reading them and the check would pass no
 * matter what. The paths live in `paths.ts` for exactly that reason.
 *
 * Drilled by editing `theme.css` by hand and watching this go red.
 */
describe('generated artifacts', () => {
  it('theme.css matches the tokens', async () => {
    const committed = await readFile(THEME_CSS_PATH, 'utf8');
    expect(committed).toBe(renderThemeCss());
  });

  it.each(Object.keys(GENERATED_SECTIONS))(
    'the %s section of DESIGN.md matches the tokens',
    async (name) => {
      const doc = await readFile(DESIGN_DOC_PATH, 'utf8');
      const render = GENERATED_SECTIONS[name];
      expect(render).toBeDefined();
      expect(readSection(doc, name)).toBe(render?.().trim());
    },
  );
});
