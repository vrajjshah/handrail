import { ScanOptionsSchema, ScanTargetSchema, scanId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { MemoryArtifactReader, MemoryScanStore } from './memory.js';
import { durationMsOf, p50, p95, percentile } from './stats.js';
import { ArtifactNotFoundError } from './types.js';

const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });
const options = ScanOptionsSchema.parse({ mode: 'deterministic' });

describe('percentile', () => {
  it('uses nearest rank, so the answer is a value that was actually observed', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(p50(samples)).toBe(50);
    expect(p95(samples)).toBe(100);
    // Interpolation would answer 55 for p50 here — a duration no scan took.
    expect(samples).toContain(p50(samples));
  });

  it('does not care what order the samples arrive in', () => {
    expect(p50([30, 10, 20])).toBe(p50([10, 20, 30]));
  });

  it('is null for no samples rather than zero', () => {
    expect(percentile([], 50)).toBeNull();
    expect(p95([])).toBeNull();
  });

  it('handles a single sample', () => {
    expect(p50([7])).toBe(7);
    expect(p95([7])).toBe(7);
  });
});

describe('durationMsOf', () => {
  it('measures a finished scan', () => {
    expect(
      durationMsOf({ startedAt: '2026-07-25T10:00:00.000Z', finishedAt: '2026-07-25T10:00:20.000Z' }),
    ).toBe(20_000);
  });

  it('is null while the scan is still running', () => {
    expect(durationMsOf({ startedAt: '2026-07-25T10:00:00.000Z' })).toBeNull();
    expect(durationMsOf({})).toBeNull();
  });

  it('rejects a backwards clock rather than reporting a negative duration', () => {
    expect(
      durationMsOf({ startedAt: '2026-07-25T10:00:20.000Z', finishedAt: '2026-07-25T10:00:00.000Z' }),
    ).toBeNull();
  });

  it('rejects an unparseable timestamp', () => {
    expect(durationMsOf({ startedAt: 'yesterday', finishedAt: 'today' })).toBeNull();
  });
});

describe('MemoryScanStore', () => {
  it('creates a queued scan with a fresh id', async () => {
    const store = new MemoryScanStore();
    const one = await store.create({ target, options });
    const two = await store.create({ target, options });
    expect(one.status).toBe('queued');
    expect(one.id).not.toBe(two.id);
  });

  it('re-validates a patch rather than merging it blind', async () => {
    const store = new MemoryScanStore();
    const scan = await store.create({ target, options });
    await expect(store.update(scan.id, { status: 'nonsense' as never })).rejects.toThrow();
    // And the stored record is untouched by the rejected patch.
    expect((await store.get(scan.id))?.record.status).toBe('queued');
  });

  it('returns undefined for an unknown scan instead of throwing', async () => {
    const store = new MemoryScanStore();
    expect(await store.get(scanId('scan_nope'))).toBeUndefined();
    expect(await store.update(scanId('scan_nope'), { status: 'running' })).toBeUndefined();
  });

  it('replays events strictly after a given seq', async () => {
    // The contract #17 depends on: `Last-Event-ID` means "I have up to and
    // including this one", so the boundary is exclusive.
    const store = new MemoryScanStore();
    const scan = await store.create({ target, options });
    const events = [0, 1, 2, 3].map((seq) => ({
      scanId: scan.id,
      seq,
      ts: '2026-07-25T10:00:00.000Z',
      type: 'log' as const,
      level: 'info' as const,
      message: `event ${String(seq)}`,
    }));
    await store.appendEvents(scan.id, events);

    expect((await store.eventsSince(scan.id, -1)).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect((await store.eventsSince(scan.id, 1)).map((e) => e.seq)).toEqual([2, 3]);
    expect(await store.eventsSince(scan.id, 3)).toEqual([]);
  });

  it('aggregates stats over what it holds', async () => {
    const store = new MemoryScanStore();
    const first = await store.create({ target, options });
    await store.update(first.id, {
      status: 'completed',
      startedAt: '2026-07-25T10:00:00.000Z',
      finishedAt: '2026-07-25T10:00:10.000Z',
      costUsd: 0.25,
      counts: { ...(await store.get(first.id))!.record.counts, findingsTotal: 3 },
    });
    const second = await store.create({ target, options });
    await store.update(second.id, { status: 'failed' });

    const stats = await store.stats();
    expect(stats).toMatchObject({ total: 2, completed: 1, failed: 1, findingsTotal: 3 });
    expect(stats.durationMs.p50).toBe(10_000);
    expect(stats.costUsdTotal).toBe(0.25);
  });
});

describe('MemoryArtifactReader', () => {
  it('rejects an unknown id with a typed error the routes can turn into a 404', async () => {
    const reader = new MemoryArtifactReader();
    await expect(reader.get('full_missing' as never)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
