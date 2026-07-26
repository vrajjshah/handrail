import { contrastTable } from './contrast.js';
import { DURATION, RADIUS, SPACING, TARGET_SIZE, TYPE_SCALE } from './scale.js';
import { COLOR_TOKEN_NAMES, DARK, LIGHT } from './tokens.js';

/**
 * `docs/DESIGN.md` carries generated sections, and a test diffs them against
 * what the tokens actually are.
 *
 * A hand-typed contrast table is a claim no reader can check and no reviewer
 * re-measures — precisely the kind of accessibility theatre this project exists
 * to argue against. Generating the numbers means the document cannot quietly
 * describe a palette that no longer ships.
 */
export function beginMarker(name: string): string {
  return `<!-- BEGIN GENERATED: ${name} -->`;
}

export function endMarker(name: string): string {
  return `<!-- END GENERATED: ${name} -->`;
}

export class MissingSectionError extends Error {
  constructor(name: string) {
    super(`docs/DESIGN.md has no generated section named ${JSON.stringify(name)}`);
    this.name = 'MissingSectionError';
  }
}

function bounds(markdown: string, name: string): { start: number; end: number } {
  const begin = markdown.indexOf(beginMarker(name));
  const end = markdown.indexOf(endMarker(name));
  if (begin === -1 || end === -1 || end < begin) throw new MissingSectionError(name);
  return { start: begin + beginMarker(name).length, end };
}

/** The current body of a generated section, without its markers. */
export function readSection(markdown: string, name: string): string {
  const { start, end } = bounds(markdown, name);
  return markdown.slice(start, end).trim();
}

/** Replace a generated section's body, leaving the rest of the document alone. */
export function writeSection(markdown: string, name: string, body: string): string {
  const { start, end } = bounds(markdown, name);
  return `${markdown.slice(0, start)}\n\n${body.trim()}\n\n${markdown.slice(end)}`;
}

/** Token name → the value each theme gives it. */
export function tokenTable(): string {
  const lines = ['| Token | Light | Dark |', '| --- | --- | --- |'];
  for (const name of COLOR_TOKEN_NAMES) {
    lines.push(`| \`--color-${name}\` | \`${LIGHT[name]}\` | \`${DARK[name]}\` |`);
  }
  return lines.join('\n');
}

/** The non-colour scales, in one place a screen author can copy from. */
export function scaleTable(): string {
  const lines = ['| Scale | Steps |', '| --- | --- |'];
  lines.push(`| Spacing (\`--spacing-*\`) | ${Object.entries(SPACING).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')} |`);
  lines.push(
    `| Type (\`--text-*\`) | ${Object.entries(TYPE_SCALE)
      .map(([k, step]) => `\`${k}\` ${step.size}/${step.lineHeight}`)
      .join(' · ')} |`,
  );
  lines.push(`| Radius (\`--radius-*\`) | ${Object.entries(RADIUS).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')} |`);
  lines.push(`| Duration (\`--duration-*\`) | ${Object.entries(DURATION).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')} |`);
  lines.push(
    `| Target size | \`--size-target-min\` ${TARGET_SIZE.min} · \`--size-target-comfortable\` ${TARGET_SIZE.comfortable} |`,
  );
  return lines.join('\n');
}

/** Every generated section of `docs/DESIGN.md`, by name. */
export const GENERATED_SECTIONS: Record<string, () => string> = {
  tokens: tokenTable,
  scales: scaleTable,
  contrast: contrastTable,
};

/** Apply every generated section to a `docs/DESIGN.md` source. */
export function renderDesignDoc(markdown: string): string {
  let next = markdown;
  for (const [name, render] of Object.entries(GENERATED_SECTIONS)) {
    next = writeSection(next, name, render());
  }
  return next;
}
