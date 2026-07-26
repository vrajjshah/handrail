import { ScanEventSchema, ScanOptionsSchema, ScanTargetSchema, scanId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { toEventValues, toScanEvent, toScanRecord, toScanValues, type ScanRow } from './rows.js';

function row(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id: 'scan_1',
    status: 'completed',
    phase: 'report',
    target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    counts: {
      pagesDiscovered: 1,
      pagesCaptured: 1,
      statesCaptured: 3,
      findingsTotal: 2,
      findingsViolation: 1,
      findingsLikely: 1,
      findingsNeedsReview: 0,
      candidatesRejected: 0,
    },
    degradations: [],
    costUsd: '0.123456',
    report: null,
    error: null,
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    startedAt: new Date('2026-07-25T10:00:01.000Z'),
    finishedAt: new Date('2026-07-25T10:00:21.000Z'),
    ...overrides,
  };
}

describe('toScanRecord', () => {
  it('round-trips through the contract that wrote it', () => {
    const record = toScanRecord(row());
    expect(record.id).toBe('scan_1');
    expect(record.counts.findingsTotal).toBe(2);
    expect(record.createdAt).toBe('2026-07-25T10:00:00.000Z');
  });

  it('reads `numeric` back as a number without losing precision', () => {
    // The driver hands back a string precisely so it cannot silently round a
    // value a double could not hold. It has to become a number somewhere, and
    // this is the somewhere.
    expect(toScanRecord(row({ costUsd: '0.123456' })).costUsd).toBe(0.123456);
    expect(toScanRecord(row({ costUsd: '0' })).costUsd).toBe(0);
  });

  it('omits the optional timestamps rather than sending null through', () => {
    const record = toScanRecord(row({ startedAt: null, finishedAt: null }));
    expect(record.startedAt).toBeUndefined();
    expect(record.finishedAt).toBeUndefined();
  });

  it('rejects a row that no longer satisfies the contract', () => {
    // The row may have been written by an older deployment or edited by hand
    // during an incident. Failing at the read is the point.
    expect(() => toScanRecord(row({ status: 'vibing' }))).toThrow();
  });

  it('survives a write-then-read cycle unchanged', () => {
    const original = toScanRecord(row());
    const written = toScanValues(original);
    expect(toScanRecord({ ...written, report: null })).toEqual(original);
  });
});

describe('event rows', () => {
  const event = ScanEventSchema.parse({
    scanId: scanId('scan_1'),
    seq: 7,
    ts: '2026-07-25T10:00:05.000Z',
    type: 'phase.started',
    phase: 'capture',
  });

  it('stores the whole event, so a replay is byte-identical to the live stream', () => {
    const values = toEventValues(event);
    expect(values.seq).toBe(7);
    expect(values.type).toBe('phase.started');
    expect(toScanEvent(values)).toEqual(event);
  });

  it('promotes type and ts to columns without reassembling the event from them', () => {
    // A replay built from the columns would drift from the live stream the
    // moment an event grew a field. The payload is the event.
    const values = toEventValues(event);
    const replayed = toScanEvent({ ...values, type: 'nonsense', ts: new Date(0) });
    expect(replayed).toEqual(event);
  });
});
