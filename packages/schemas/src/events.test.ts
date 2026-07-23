import { describe, expect, it } from 'vitest';

import { makeFinding } from './__test__/factories.js';
import { ScanEventSchema, isTerminalEvent } from './events.js';

const base = { scanId: 'scan_1', seq: 0, ts: '2026-07-23T10:00:00.000Z' };

describe('ScanEventSchema', () => {
  it('parses a phase event', () => {
    const event = ScanEventSchema.parse({ ...base, type: 'phase.started', phase: 'capture' });

    expect(event.type).toBe('phase.started');
  });

  it('parses a finding event and applies the finding invariant inside it', () => {
    const event = ScanEventSchema.parse({
      ...base,
      type: 'finding.detected',
      finding: makeFinding({ source: 'ai-text', tier: 'violation', evidence: [] }),
    });

    if (event.type !== 'finding.detected') throw new Error('wrong event type');
    expect(event.finding.tier).toBe('needs-review');
  });

  it('parses a degradation event, so a degraded scan is visible live', () => {
    const event = ScanEventSchema.parse({
      ...base,
      type: 'scan.degraded',
      degradation: {
        reason: 'model-unavailable',
        detail: 'anthropic returned 529 after 3 retries',
        phase: 'judge-text',
        at: base.ts,
      },
    });

    expect(event.type).toBe('scan.degraded');
  });

  it('rejects an unknown event type rather than passing it through', () => {
    expect(() => ScanEventSchema.parse({ ...base, type: 'surprise' })).toThrow();
  });

  it('rejects a phase event naming a phase that does not exist', () => {
    expect(() =>
      ScanEventSchema.parse({ ...base, type: 'phase.started', phase: 'vibes' }),
    ).toThrow();
  });

  it('requires a sequence number, which is what makes SSE replay exact', () => {
    expect(() =>
      ScanEventSchema.parse({
        scanId: 'scan_1',
        ts: base.ts,
        type: 'phase.started',
        phase: 'crawl',
      }),
    ).toThrow();
  });
});

describe('isTerminalEvent', () => {
  it('is true for the two events after which nothing more arrives', () => {
    const completed = ScanEventSchema.parse({
      ...base,
      type: 'scan.completed',
      findingsTotal: 3,
      costUsd: 0,
      durationMs: 1200,
    });
    const failed = ScanEventSchema.parse({
      ...base,
      type: 'scan.failed',
      code: 'capture-failed',
      message: 'chromium crashed',
    });

    expect(isTerminalEvent(completed)).toBe(true);
    expect(isTerminalEvent(failed)).toBe(true);
  });

  it('is false mid-scan', () => {
    const event = ScanEventSchema.parse({ ...base, type: 'phase.completed', phase: 'crawl', durationMs: 10 });

    expect(isTerminalEvent(event)).toBe(false);
  });
});
