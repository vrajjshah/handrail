import { randomUUID } from 'node:crypto';

import {
  ScanRecordSchema,
  scanId as toScanId,
  type Finding,
  type Report,
  type ScanEvent,
  type ScanId,
  type ScanRecord,
} from '@handrail/schemas';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { findings as findingsTable, scanEvents, scans } from '../db/schema.js';
import {
  toEventValues,
  toFindingValues,
  toReport,
  toScanEvent,
  toScanRecord,
  toScanValues,
} from './rows.js';
import { p50, p95 } from './stats.js';
import type { CreateScanInput, ScanStats, ScanStore, StoredScan } from './types.js';

/**
 * The durable {@link ScanStore}.
 *
 * Same interface as the in-memory one, so no route knows which is behind it.
 * What changes is the property #18 exists for: a scan written here outlives the
 * process that wrote it, which is the difference between a worker restart being
 * an inconvenience and being a lost scan.
 */
export class PostgresScanStore implements ScanStore {
  private readonly db: Database;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(db: Database, options: { now?: () => Date; newId?: () => string } = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `scan_${randomUUID()}`);
  }

  async create(input: CreateScanInput): Promise<ScanRecord> {
    const record = ScanRecordSchema.parse({
      id: toScanId(this.newId()),
      target: input.target,
      options: input.options,
      status: 'queued',
      phase: 'queued',
      createdAt: this.now().toISOString(),
    });

    await this.db.insert(scans).values({
      ...toScanValues(record),
      report: null,
      clientIp: input.clientIp ?? null,
    });
    return record;
  }

  async get(id: ScanId): Promise<StoredScan | undefined> {
    const [row] = await this.db.select().from(scans).where(eq(scans.id, id)).limit(1);
    if (row === undefined) return undefined;
    const report = toReport(row.report);
    return { record: toScanRecord(row), ...(report === undefined ? {} : { report }) };
  }

  async update(id: ScanId, patch: Partial<ScanRecord>): Promise<ScanRecord | undefined> {
    const existing = await this.get(id);
    if (existing === undefined) return undefined;

    // Read-modify-validate-write rather than a partial UPDATE. A patch that
    // would produce an invalid record has to fail *before* it is written, and
    // the only thing that can decide that is the whole record.
    const next = ScanRecordSchema.parse({ ...existing.record, ...patch });
    await this.db.update(scans).set(toScanValues(next)).where(eq(scans.id, id));
    return next;
  }

  async saveReport(id: ScanId, report: Report): Promise<void> {
    await this.db.update(scans).set({ report }).where(eq(scans.id, id));
  }

  async appendEvents(id: ScanId, events: readonly ScanEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(scanEvents)
      .values(events.map(toEventValues))
      // A worker that is retried can legitimately re-emit an event it already
      // wrote. The primary key makes a duplicate `seq` impossible; this makes
      // re-writing one harmless rather than a crash. `seq` is the SSE id, so
      // the first write is the one that counts.
      .onConflictDoNothing({ target: [scanEvents.scanId, scanEvents.seq] });
  }

  async eventsSince(id: ScanId, afterSeq: number): Promise<ScanEvent[]> {
    const rows = await this.db
      .select()
      .from(scanEvents)
      .where(and(eq(scanEvents.scanId, id), gt(scanEvents.seq, afterSeq)))
      .orderBy(asc(scanEvents.seq));
    return rows.map(toScanEvent);
  }

  /** The highest `seq` written for a scan, or -1 when there are none. */
  async lastSeq(id: ScanId): Promise<number> {
    const [row] = await this.db
      .select({ max: sql<number | null>`max(${scanEvents.seq})` })
      .from(scanEvents)
      .where(eq(scanEvents.scanId, id));
    return row?.max ?? -1;
  }

  async saveFindings(id: ScanId, incoming: readonly Finding[]): Promise<void> {
    if (incoming.length === 0) return;
    const now = this.now();
    await this.db
      .insert(findingsTable)
      .values(incoming.map((finding) => toFindingValues(id, finding, now)))
      // Finding ids are content-derived, so the same finding seen twice is the
      // same row. On a resumed scan that is expected, not an error.
      .onConflictDoNothing({ target: findingsTable.id });
  }

  async stats(): Promise<ScanStats> {
    const [totals] = await this.db
      .select({
        total: count(),
        completed: sql<number>`count(*) filter (where ${scans.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${scans.status} = 'failed')::int`,
        running: sql<number>`count(*) filter (where ${scans.status} = 'running')::int`,
        costUsdTotal: sql<string>`coalesce(sum(${scans.costUsd}), 0)::text`,
        findingsTotal: sql<number>`coalesce(sum((${scans.counts}->>'findingsTotal')::int), 0)::int`,
      })
      .from(scans);

    // Percentiles are computed in Node from the durations, not with
    // `percentile_cont`: the two disagree (Postgres interpolates by default),
    // and one definition of p95 across the CLI, the API and the in-memory store
    // is worth more than saving a round trip.
    const durations = await this.db
      .select({
        ms: sql<number>`(extract(epoch from (${scans.finishedAt} - ${scans.startedAt})) * 1000)::int`,
      })
      .from(scans)
      .where(
        and(
          sql`${scans.startedAt} is not null`,
          sql`${scans.finishedAt} is not null`,
          sql`${scans.finishedAt} >= ${scans.startedAt}`,
        ),
      );
    const samples = durations.map((row) => row.ms).filter((ms) => Number.isFinite(ms));

    return {
      total: totals?.total ?? 0,
      completed: totals?.completed ?? 0,
      failed: totals?.failed ?? 0,
      running: totals?.running ?? 0,
      durationMs: { p50: p50(samples), p95: p95(samples) },
      findingsTotal: totals?.findingsTotal ?? 0,
      costUsdTotal: Number(totals?.costUsdTotal ?? '0'),
    };
  }
}
