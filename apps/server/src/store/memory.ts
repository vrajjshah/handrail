import { randomUUID } from 'node:crypto';

import {
  ScanRecordSchema,
  scanId as toScanId,
  type ArtifactId,
  type Finding,
  type Report,
  type ScanEvent,
  type ScanId,
  type ScanRecord,
} from '@handrail/schemas';

import type { ScanEventBus } from '../events/bus.js';
import { durationMsOf, p50, p95 } from './stats.js';
import {
  ArtifactNotFoundError,
  type ArtifactReader,
  type CreateScanInput,
  type ScanStats,
  type ScanStore,
  type StoredScan,
} from './types.js';

interface Entry {
  record: ScanRecord;
  report?: Report;
  events: ScanEvent[];
  /** Keyed by id, because a resumed scan re-emits findings it already sent. */
  findings: Map<string, Finding>;
  clientIp?: string;
}

/**
 * An in-memory {@link ScanStore}.
 *
 * Not a stub: it is the real implementation for local development, for the test
 * suite, and for anyone running the server without a database. #18 adds the
 * Postgres one beside it, and this stays as the thing every route test runs
 * against — an API test that needs a database to assert a 404 is a slow test
 * about the wrong subject.
 *
 * What it cannot do is survive a restart, which is exactly the property #18's
 * acceptance criterion is about.
 */
export class MemoryScanStore implements ScanStore {
  private readonly scans = new Map<string, Entry>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly bus: ScanEventBus | undefined;

  constructor(
    options: { now?: () => Date; newId?: () => string; bus?: ScanEventBus } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `scan_${randomUUID()}`);
    this.bus = options.bus;
  }

  create(input: CreateScanInput): Promise<ScanRecord> {
    const record = ScanRecordSchema.parse({
      id: toScanId(this.newId()),
      target: input.target,
      options: input.options,
      status: 'queued',
      phase: 'queued',
      createdAt: this.now().toISOString(),
    });
    this.scans.set(record.id, {
      record,
      events: [],
      findings: new Map(),
      ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
    });
    return Promise.resolve(record);
  }

  get(id: ScanId): Promise<StoredScan | undefined> {
    const entry = this.scans.get(id);
    if (entry === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      record: entry.record,
      ...(entry.report === undefined ? {} : { report: entry.report }),
    });
  }

  update(id: ScanId, patch: Partial<ScanRecord>): Promise<ScanRecord | undefined> {
    const entry = this.scans.get(id);
    if (entry === undefined) return Promise.resolve(undefined);

    // Re-parsed rather than merged blind: a patch that would produce an invalid
    // record fails here, at the caller, rather than later in a serializer where
    // it looks like a rendering bug. Rejected rather than thrown, so a
    // promise-returning method never surprises a caller with a synchronous
    // throw — the store's Postgres sibling will only ever be able to reject.
    const parsed = ScanRecordSchema.safeParse({ ...entry.record, ...patch });
    if (!parsed.success) return Promise.reject(parsed.error);

    entry.record = parsed.data;
    return Promise.resolve(entry.record);
  }

  saveReport(id: ScanId, report: Report): Promise<void> {
    const entry = this.scans.get(id);
    if (entry === undefined) return Promise.resolve();
    entry.report = report;
    return Promise.resolve();
  }

  async appendEvents(id: ScanId, events: readonly ScanEvent[]): Promise<void> {
    const entry = this.scans.get(id);
    if (entry === undefined) return;
    entry.events.push(...events);
    // Notifying from inside the append is what makes the SSE stream correct by
    // construction: there is no way to write events and forget to announce them.
    await this.bus?.notify(id);
  }

  eventsSince(id: ScanId, afterSeq: number): Promise<ScanEvent[]> {
    const entry = this.scans.get(id);
    if (entry === undefined) return Promise.resolve([]);
    return Promise.resolve(entry.events.filter((event) => event.seq > afterSeq));
  }

  lastSeq(id: ScanId): Promise<number> {
    const entry = this.scans.get(id);
    if (entry === undefined || entry.events.length === 0) return Promise.resolve(-1);
    return Promise.resolve(Math.max(...entry.events.map((event) => event.seq)));
  }

  saveFindings(id: ScanId, incoming: readonly Finding[]): Promise<void> {
    const entry = this.scans.get(id);
    if (entry === undefined) return Promise.resolve();
    for (const finding of incoming) entry.findings.set(finding.id, finding);
    return Promise.resolve();
  }

  recentScanTimesForIp(clientIp: string, since: Date): Promise<Date[]> {
    const times = [...this.scans.values()]
      .filter((entry) => entry.clientIp === clientIp)
      .map((entry) => new Date(entry.record.createdAt))
      .filter((at) => at >= since);
    return Promise.resolve(times);
  }

  countRunning(): Promise<number> {
    return Promise.resolve(
      [...this.scans.values()].filter((entry) => entry.record.status === 'running').length,
    );
  }

  stats(): Promise<ScanStats> {
    const entries = [...this.scans.values()];
    const durations = entries
      .map((entry) => durationMsOf(entry.record))
      .filter((value): value is number => value !== null);

    return Promise.resolve({
      total: entries.length,
      completed: entries.filter((entry) => entry.record.status === 'completed').length,
      failed: entries.filter((entry) => entry.record.status === 'failed').length,
      running: entries.filter((entry) => entry.record.status === 'running').length,
      durationMs: { p50: p50(durations), p95: p95(durations) },
      findingsTotal: entries.reduce((sum, entry) => sum + entry.record.counts.findingsTotal, 0),
      costUsdTotal:
        Math.round(entries.reduce((sum, entry) => sum + entry.record.costUsd, 0) * 1e6) / 1e6,
    });
  }
}

/** An in-memory {@link ArtifactReader}, for tests and for `--no-artifacts` runs. */
export class MemoryArtifactReader implements ArtifactReader {
  private readonly items = new Map<string, Buffer>();

  put(id: ArtifactId, bytes: Buffer): void {
    this.items.set(id, bytes);
  }

  get(id: ArtifactId): Promise<Buffer> {
    const bytes = this.items.get(id);
    if (bytes === undefined) return Promise.reject(new ArtifactNotFoundError(id));
    return Promise.resolve(bytes);
  }

  /**
   * Nothing to sign against: there is no storage to hand a client at, so the
   * route serves the bytes itself. That is the local-development shape, and it
   * is the reason the byte-serving branch stays exercised by the default test
   * suite rather than only by whoever has R2 credentials.
   */
  signedUrl(id: ArtifactId): Promise<string | undefined> {
    if (!this.items.has(id)) return Promise.reject(new ArtifactNotFoundError(id));
    return Promise.resolve(undefined);
  }
}
