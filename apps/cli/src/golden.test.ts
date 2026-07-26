import type { Report, ScanEvent } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { buildSnapshot, describeDiff, normalizeEvents, normalizeReport } from './golden.js';

const event = (over: Partial<ScanEvent> = {}): ScanEvent =>
  ({
    scanId: 'scan_1',
    seq: 0,
    ts: '2026-07-25T10:00:00.000Z',
    type: 'phase.started',
    phase: 'crawl',
    ...over,
  }) as ScanEvent;

describe('normalizeEvents', () => {
  it('keeps the shape that matters and drops the per-run noise', () => {
    expect(normalizeEvents([event()])).toEqual([{ type: 'phase.started', phase: 'crawl' }]);
  });

  it('preserves node order — the drift this snapshot exists to catch', () => {
    const stream = normalizeEvents([event({ phase: 'site' }), event({ phase: 'score' })]);
    expect(stream.map((e) => (e as { phase: string }).phase)).toEqual(['site', 'score']);
  });

  it('records a finding by check, tier and criterion rather than its prose', () => {
    // Built without the helper's default `phase`: a real `finding.detected`
    // carries none, and inheriting one here would assert the wrong shape.
    const detected = normalizeEvents([
      {
        scanId: 'scan_1',
        seq: 0,
        ts: '2026-07-25T10:00:00.000Z',
        type: 'finding.detected',
        finding: {
          checkId: 'axe.image-alt',
          tier: 'violation',
          scPrimary: '1.1.1',
          description: 'wording that may be reworded without changing behaviour',
        },
      } as unknown as ScanEvent,
    ]);
    expect(detected[0]).toEqual({
      type: 'finding.detected',
      checkId: 'axe.image-alt',
      tier: 'violation',
      scPrimary: '1.1.1',
    });
  });

  it('does not let a duration into the snapshot', () => {
    const completed = normalizeEvents([
      event({ type: 'phase.completed', phase: 'crawl', durationMs: 37 }),
    ]);
    expect(JSON.stringify(completed)).not.toContain('37');
  });
});

describe('normalizeReport', () => {
  const report = (over: Record<string, unknown> = {}): Report =>
    ({
      reportVersion: 1,
      generatedAt: '2026-07-25T10:00:00.000Z',
      scan: { id: 'scan_abc', createdAt: '2026-07-25T10:00:00.000Z', costUsd: 0 },
      findings: [{ id: 'find_deadbeef', checkId: 'axe.image-alt', tier: 'violation' }],
      ...over,
    }) as unknown as Report;

  it('scrubs timestamps and per-run ids', () => {
    const out = normalizeReport(report()) as {
      generatedAt: string;
      scan: Record<string, unknown>;
    };
    expect(out.generatedAt).toBe('<normalised>');
    expect(out.scan.id).toBe('<normalised>');
    expect(out.scan.createdAt).toBe('<normalised>');
  });

  it('keeps a finding id — it is a content hash, so a change in it is real drift', () => {
    const out = normalizeReport(report()) as { findings: { id: string }[] };
    expect(out.findings[0]?.id).toBe('find_deadbeef');
  });

  it('replaces volatile values rather than deleting the key', () => {
    // A normaliser that dropped keys would hide a field disappearing from the
    // report, which is precisely the shape drift the snapshot is meant to catch.
    const out = normalizeReport(report()) as Record<string, unknown>;
    expect(Object.keys(out)).toContain('generatedAt');
  });

  it('scrubs absolute paths, which differ per machine', () => {
    const out = normalizeReport(
      report({ outputs: { reportPath: '/Users/someone/handrail/out/report.json' } }),
    ) as { outputs: { reportPath: string } };
    expect(out.outputs.reportPath).toBe('<normalised>');
  });

  it('sorts keys so a reordered object is not a diff', () => {
    const a = JSON.stringify(normalizeReport(report({ alpha: 1, beta: 2 })));
    const b = JSON.stringify(normalizeReport(report({ beta: 2, alpha: 1 })));
    expect(a).toBe(b);
  });
});

describe('describeDiff', () => {
  it('points at the differing line with its number and both sides', () => {
    const diff = describeDiff('a\nb\nc', 'a\nCHANGED\nc');
    expect(diff).toContain('b');
    expect(diff).toContain('CHANGED');
    expect(diff).toMatch(/-\s+2/);
    expect(diff).toMatch(/\+\s+2/);
  });

  it('is empty when the snapshots agree', () => {
    expect(describeDiff('same\ntext', 'same\ntext')).toBe('');
  });

  it('caps the output so a wholesale change stays readable', () => {
    const before = Array.from({ length: 500 }, (_, i) => `line ${String(i)}`).join('\n');
    const after = Array.from({ length: 500 }, (_, i) => `other ${String(i)}`).join('\n');
    expect(describeDiff(before, after)).toContain('and more');
  });
});

describe('buildSnapshot', () => {
  it('carries both halves: the stream shape and the report content', () => {
    const snapshot = buildSnapshot([event()], {
      reportVersion: 1,
      generatedAt: '2026-07-25T10:00:00.000Z',
    } as unknown as Report);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.report).toBeDefined();
  });
});
