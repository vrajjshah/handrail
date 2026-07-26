import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the generated artifacts live.
 *
 * These are in their own module, with no side effects, because
 * `scripts/build-tokens.ts` ends in `await main()` — importing the script for
 * its path constants would regenerate the very files the drift test is about to
 * check, and the test would pass unconditionally. That has happened in this
 * repo once already (see AGENTS.md).
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export const THEME_CSS_PATH = path.resolve(here, '../theme.css');
export const DESIGN_DOC_PATH = path.resolve(here, '../../../docs/DESIGN.md');
