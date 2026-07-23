import type { Evidence } from '../evidence.js';
import type { FindingInput } from '../finding.js';
import { artifactId } from '../primitives.js';
import type { ScanRecordInput } from '../scan.js';

/**
 * Minimal valid objects for tests to mutate. Every factory returns the smallest
 * thing that parses, so a test's edits are the only interesting part of it.
 */

export const toolEvidence: Evidence = {
  kind: 'tool',
  tool: 'axe-core',
  ruleId: 'image-alt',
  output: 'Element does not have an alt attribute',
};

export const screenshotEvidence: Evidence = {
  kind: 'screenshot',
  artifactId: artifactId('art_1'),
  bbox: { x: 10, y: 20, width: 100, height: 40 },
};

export const pixelEvidence: Evidence = {
  kind: 'pixels',
  metric: 'contrast-ratio',
  measured: 2.9,
  threshold: 4.5,
  comparator: 'gte',
};

export function makeFinding(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    id: 'find_1',
    checkId: 'axe.image-alt',
    source: 'axe',
    sc: ['1.1.1'],
    scPrimary: '1.1.1',
    tier: 'violation',
    severity: 'critical',
    confidence: 1,
    evidence: [toolEvidence],
    page: {
      url: 'https://example.com/',
      pageStateId: 'state_1',
      viewport: 'desktop',
    },
    verification: { method: 'deterministic-recheck', status: 'confirmed' },
    description: 'Image has no text alternative.',
    ...overrides,
  };
}

export function makeScanRecord(overrides: Partial<ScanRecordInput> = {}): ScanRecordInput {
  return {
    id: 'scan_1',
    target: { kind: 'url', url: 'https://example.com/' },
    options: {},
    status: 'completed',
    createdAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}
