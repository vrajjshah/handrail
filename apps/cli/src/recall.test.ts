import type { Finding } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { measureRecall, type GroundTruthDefect } from './recall.js';

const defect = (over: Partial<GroundTruthDefect> = {}): GroundTruthDefect => ({
  id: 'gt-001',
  sc: ['1.1.1'],
  scPrimary: '1.1.1',
  severity: 'critical',
  detectableBy: ['deterministic'],
  ...over,
});

const finding = (xpath: string, over: Partial<Finding> = {}): Finding =>
  ({
    id: 'find_1',
    checkId: 'axe.image-alt',
    tier: 'violation',
    element: { xpath, selector: 'img' },
    ...over,
  }) as unknown as Finding;

describe('measureRecall', () => {
  it('counts a defect as found when a finding lands on its anchored element', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [defect()],
      traps: [],
      anchors: { 'gt-001': '/html[1]/img[1]' },
      findings: [finding('/html[1]/img[1]')],
    });

    expect(baseline.overall).toEqual({ planted: 1, found: 1, recall: 1 });
    expect(baseline.defects[0]?.foundBy).toBe('axe.image-alt');
    expect(baseline.defects[0]?.tier).toBe('violation');
  });

  it('does not credit a finding that landed on a different element', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [defect()],
      traps: [],
      anchors: { 'gt-001': '/html[1]/img[1]' },
      findings: [finding('/html[1]/img[2]')],
    });

    expect(baseline.overall.found).toBe(0);
    expect(baseline.defects[0]?.foundBy).toBeUndefined();
  });

  it('breaks recall down by the layer that was meant to catch each defect', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [
        defect({ id: 'gt-001', detectableBy: ['deterministic'] }),
        defect({ id: 'gt-002', detectableBy: ['ai-vision'] }),
        defect({ id: 'gt-003', detectableBy: ['ai-vision'] }),
      ],
      traps: [],
      anchors: { 'gt-001': '/a', 'gt-002': '/b', 'gt-003': '/c' },
      findings: [finding('/a')],
    });

    const byClass = Object.fromEntries(
      baseline.byDetectabilityClass.map((row) => [row.detectableBy, row]),
    );
    expect(byClass.deterministic).toMatchObject({ planted: 1, found: 1, recall: 1 });
    // A layer that does not exist yet reads as 0, plainly, rather than being
    // left out of the denominator to flatter the headline.
    expect(byClass['ai-vision']).toMatchObject({ planted: 2, found: 0, recall: 0 });
  });

  it('reports a flagged trap — a recall number without this beside it is dishonest', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [defect()],
      traps: [{ id: 'trap-contrast-ok' }],
      anchors: { 'gt-001': '/a', 'trap-contrast-ok': '/trap' },
      findings: [finding('/a'), finding('/trap')],
    });

    expect(baseline.trapsFlagged).toEqual(['trap-contrast-ok']);
  });

  it('reports no traps when the correct-looking elements were left alone', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [defect()],
      traps: [{ id: 'trap-contrast-ok' }],
      anchors: { 'gt-001': '/a', 'trap-contrast-ok': '/trap' },
      findings: [finding('/a')],
    });

    expect(baseline.trapsFlagged).toEqual([]);
  });

  it('treats a defect with no anchor as not found rather than crashing', () => {
    const baseline = measureRecall({
      fixture: 'seeded-demo',
      defects: [defect({ id: 'gt-999' })],
      traps: [],
      anchors: {},
      findings: [finding('/a')],
    });

    expect(baseline.overall.found).toBe(0);
  });
});
