/**
 * Regenerate `theme.css` and the generated sections of `docs/DESIGN.md`.
 *
 *     pnpm --filter @handrail/tokens tokens:build
 *
 * Both outputs are committed, and `generated.test.ts` fails when either has
 * drifted from the source of truth — the same pattern as the generated axe map.
 * The diff a token change produces *is* the change in what Handrail's own UI
 * claims about itself, so it gets reviewed next to the change that caused it.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { renderThemeCss } from '../css.js';
import { failingPairs } from '../contrast.js';
import { renderDesignDoc } from '../design-doc.js';
import { DESIGN_DOC_PATH, THEME_CSS_PATH } from '../paths.js';

async function main(): Promise<void> {
  // Refuse to emit a palette that does not meet its own requirements. Writing
  // the file first and failing the test later would put a failing token set in
  // the tree, where somebody would build a screen on it.
  const failing = failingPairs();
  if (failing.length > 0) {
    for (const result of failing) {
      process.stderr.write(
        `${result.theme}: ${result.foreground} on ${result.background} is ` +
          `${result.ratio.toFixed(2)}:1, needs ${String(result.threshold)}:1 (${result.usage})\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  await writeFile(THEME_CSS_PATH, renderThemeCss(), 'utf8');

  const design = await readFile(DESIGN_DOC_PATH, 'utf8');
  await writeFile(DESIGN_DOC_PATH, renderDesignDoc(design), 'utf8');

  process.stdout.write(`wrote ${THEME_CSS_PATH}\nwrote ${DESIGN_DOC_PATH}\n`);
}

await main();
