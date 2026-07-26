import {
  FindingSchema,
  ScanEventSchema,
  findingId,
  pageStateId,
  scanId,
  type ScanEvent,
} from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { ANSI, ProgressRenderer, colorEnabled } from './render.js';

let seq = 0;
function event(body: Record<string, unknown>): ScanEvent {
  return ScanEventSchema.parse({
    scanId: scanId('scan_render'),
    seq: seq++,
    ts: '2026-07-25T10:00:00.000Z',
    ...body,
  });
}

function finding(overrides: Record<string, unknown> = {}) {
  return FindingSchema.parse({
    id: findingId('find_1'),
    checkId: 'axe.image-alt',
    source: 'axe',
    sc: ['1.1.1'],
    scPrimary: '1.1.1',
    tier: 'violation',
    severity: 'critical',
    confidence: 1,
    evidence: [{ kind: 'tool', tool: 'axe-core', ruleId: 'image-alt', output: 'no alt' }],
    element: { selector: 'img.hero' },
    page: { url: 'https://example.com/', pageStateId: pageStateId('st_1'), viewport: 'desktop' },
    verification: { method: 'none', status: 'unverified' },
    description: 'Image has no text alternative.',
    ...overrides,
  });
}

function collect(options: { quiet?: boolean; color?: boolean } = {}) {
  const lines: string[] = [];
  const renderer = new ProgressRenderer({ write: (line) => lines.push(line), ...options });
  return { lines, renderer };
}

describe('the progress renderer', () => {
  it('names each phase as it starts', () => {
    const { lines, renderer } = collect();
    renderer.event(event({ type: 'phase.started', phase: 'capture' }));
    renderer.event(event({ type: 'phase.completed', phase: 'capture', durationMs: 1500 }));
    expect(lines[0]).toBe('> capture');
    expect(lines[1]).toContain('1.5s');
  });

  it('prints a finding with its tier spelled out, never colour alone', () => {
    const { lines, renderer } = collect();
    renderer.event(event({ type: 'finding.detected', finding: finding() }));
    expect(lines[0]).toContain('violation');
    expect(lines[0]).toContain('1.1.1');
    expect(lines[0]).toContain('axe.image-alt');
    expect(lines[0]).toContain('img.hero');
    // No escape sequences at all when colour is off.
    expect(lines[0]).not.toContain(ANSI.red);
  });

  it('counts what the stream reports rather than deriving its own totals', () => {
    const { renderer } = collect({ quiet: true });
    renderer.event(event({ type: 'finding.detected', finding: finding() }));
    renderer.event(
      event({ type: 'finding.detected', finding: finding({ id: findingId('f2'), tier: 'needs-review' }) }),
    );
    expect(renderer.totals).toMatchObject({ findings: 2, violation: 1, needsReview: 1 });
  });

  it('always shows a degradation, even when quiet', () => {
    const { lines, renderer } = collect({ quiet: true });
    renderer.event(
      event({
        type: 'scan.degraded',
        degradation: {
          reason: 'model-unavailable',
          detail: 'provider returned 429',
          at: '2026-07-25T10:00:00.000Z',
        },
      }),
    );
    expect(lines[0]).toContain('DEGRADED model-unavailable');
    expect(renderer.totals.degradations).toBe(1);
  });

  it('suppresses per-finding chatter when quiet but still counts it', () => {
    const { lines, renderer } = collect({ quiet: true });
    renderer.event(event({ type: 'finding.detected', finding: finding() }));
    renderer.event(event({ type: 'log', level: 'info', message: 'resolved 1 url(s) to scan' }));
    expect(lines).toEqual([]);
    expect(renderer.totals.findings).toBe(1);
  });

  it('paints when asked to', () => {
    const { lines, renderer } = collect({ color: true });
    renderer.event(event({ type: 'phase.started', phase: 'detect' }));
    expect(lines[0]?.startsWith(ANSI.bold)).toBe(true);
    expect(lines[0]?.endsWith(ANSI.reset)).toBe(true);
  });

  it('reports the completion line with cost', () => {
    const { lines, renderer } = collect();
    renderer.event(event({ type: 'scan.completed', findingsTotal: 4, costUsd: 0.0123, durationMs: 8200 }));
    expect(lines[0]).toContain('4 finding(s)');
    expect(lines[0]).toContain('$0.0123');
  });
});

describe('colorEnabled', () => {
  it('follows NO_COLOR, FORCE_COLOR, TERM=dumb and then the tty', () => {
    expect(colorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(colorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
    expect(colorEnabled({ TERM: 'dumb' }, true)).toBe(false);
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
  });
});
