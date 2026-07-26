import {
  ReportSchema,
  ScanEventSchema,
  ScanRecordSchema,
  type Finding,
  type Report,
  type ScanEvent,
  type ScanId,
  type ScanRecord,
} from '@handrail/schemas';

/**
 * Row ↔ domain object, in one place, with no database in sight.
 *
 * Everything that leaves Postgres is re-parsed through the contract that
 * created it. That is not paranoia about our own writer: the row may have been
 * written by an older deployment, by a migration, or by hand during an
 * incident, and a `Report` that no longer satisfies `ReportSchema` should fail
 * where it is read rather than three layers later in a renderer.
 *
 * These functions are pure so they can be tested without a database, which is
 * what keeps the mapping in the three-OS `unit` job.
 */

export interface ScanRow {
  id: string;
  status: string;
  phase: string;
  target: unknown;
  options: unknown;
  counts: unknown;
  degradations: unknown;
  costUsd: string;
  report: unknown;
  error: unknown;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export function toScanRecord(row: ScanRow): ScanRecord {
  return ScanRecordSchema.parse({
    id: row.id,
    status: row.status,
    phase: row.phase,
    target: row.target,
    options: row.options,
    counts: row.counts,
    degradations: row.degradations,
    // `numeric` comes back as a string, on purpose — the driver will not
    // silently round a value wider than a double. It is a number by the time it
    // reaches a caller.
    costUsd: Number(row.costUsd),
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt.toISOString() }),
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt.toISOString() }),
    ...(row.error === null || row.error === undefined ? {} : { error: row.error }),
  });
}

export function toReport(value: unknown): Report | undefined {
  return value === null || value === undefined ? undefined : ReportSchema.parse(value);
}

/** The columns a `ScanRecord` writes. Timestamps become `Date`s for the driver. */
export function toScanValues(record: ScanRecord): Omit<ScanRow, 'report'> {
  return {
    id: record.id,
    status: record.status,
    phase: record.phase,
    target: record.target,
    options: record.options,
    counts: record.counts,
    degradations: record.degradations,
    costUsd: record.costUsd.toFixed(6),
    error: record.error ?? null,
    createdAt: new Date(record.createdAt),
    startedAt: record.startedAt === undefined ? null : new Date(record.startedAt),
    finishedAt: record.finishedAt === undefined ? null : new Date(record.finishedAt),
  };
}

export interface EventRow {
  scanId: string;
  seq: number;
  type: string;
  ts: Date;
  payload: unknown;
}

export function toScanEvent(row: EventRow): ScanEvent {
  // The whole event is stored, so a replay is byte-identical to what the live
  // stream sent. The `type` and `ts` columns exist to be queried, not to be
  // reassembled from.
  return ScanEventSchema.parse(row.payload);
}

export function toEventValues(event: ScanEvent): EventRow {
  return {
    scanId: event.scanId,
    seq: event.seq,
    type: event.type,
    ts: new Date(event.ts),
    payload: event,
  };
}

export interface FindingValues {
  id: string;
  scanId: string;
  checkId: string;
  scPrimary: string;
  tier: string;
  severity: string;
  pageUrl: string;
  data: unknown;
  createdAt: Date;
}

export function toFindingValues(scanId: ScanId, finding: Finding, now: Date): FindingValues {
  return {
    id: finding.id,
    scanId,
    checkId: finding.checkId,
    scPrimary: finding.scPrimary,
    tier: finding.tier,
    severity: finding.severity,
    pageUrl: finding.page.url,
    data: finding,
    createdAt: now,
  };
}
