import { describe, expect, it } from 'vitest';

import {
  MissingSectionError,
  beginMarker,
  endMarker,
  readSection,
  renderDesignDoc,
  scaleTable,
  tokenTable,
  writeSection,
} from './design-doc.js';
import { COLOR_TOKEN_NAMES } from './tokens.js';

const doc = [
  '# Design',
  '',
  'Prose above.',
  '',
  beginMarker('tokens'),
  '',
  'stale content',
  '',
  endMarker('tokens'),
  '',
  'Prose below.',
  '',
].join('\n');

describe('generated sections', () => {
  it('reads a section body without its markers', () => {
    expect(readSection(doc, 'tokens')).toBe('stale content');
  });

  it('replaces only the section body', () => {
    const next = writeSection(doc, 'tokens', 'fresh content');
    expect(readSection(next, 'tokens')).toBe('fresh content');
    expect(next).toContain('Prose above.');
    expect(next).toContain('Prose below.');
  });

  it('is idempotent, so regenerating an unchanged doc produces no diff', () => {
    const once = writeSection(doc, 'tokens', 'fresh content');
    expect(writeSection(once, 'tokens', 'fresh content')).toBe(once);
  });

  it('throws rather than silently appending when the marker is missing', () => {
    expect(() => writeSection('# Design\n', 'tokens', 'x')).toThrow(MissingSectionError);
    expect(() => readSection('# Design\n', 'contrast')).toThrow(MissingSectionError);
  });

  it('throws when the markers are inverted', () => {
    const inverted = [endMarker('tokens'), beginMarker('tokens')].join('\n');
    expect(() => readSection(inverted, 'tokens')).toThrow(MissingSectionError);
  });

  it('renderDesignDoc fills every section it knows about', () => {
    const full = ['tokens', 'scales', 'contrast']
      .map((name) => [beginMarker(name), 'stale', endMarker(name)].join('\n'))
      .join('\n\n');
    const rendered = renderDesignDoc(full);
    expect(rendered).not.toContain('stale');
    expect(readSection(rendered, 'tokens')).toBe(tokenTable());
    expect(readSection(rendered, 'scales')).toBe(scaleTable());
  });
});

describe('tokenTable', () => {
  it('lists every token with both theme values', () => {
    const table = tokenTable();
    for (const name of COLOR_TOKEN_NAMES) {
      expect(table).toContain(`\`--color-${name}\``);
    }
    expect(table.split('\n')).toHaveLength(COLOR_TOKEN_NAMES.length + 2);
  });
});
