import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * The persistent shape of a scan.
 *
 * Two rules run through this file.
 *
 * **The canonical objects stay whole.** `target`, `options`, `report` and the
 * event payloads are stored as `jsonb` exactly as `@handrail/schemas` produced
 * them, and read back through the same schema. Shredding a `Report` into
 * columns would make the database a second, subtly different definition of what
 * a report is — and the first time the two disagreed, nobody would know which
 * was right.
 *
 * **What is promoted to a column is what is queried or indexed**: status, tier,
 * timestamps, ids. Those are duplicated *from* the JSON, never instead of it.
 */

export const scans = pgTable(
  'scans',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    phase: text('phase').notNull(),

    /** `ScanTarget` and `ScanOptions`, verbatim. */
    target: jsonb('target').notNull(),
    options: jsonb('options').notNull(),
    counts: jsonb('counts').notNull(),
    degradations: jsonb('degradations').notNull(),

    /**
     * `numeric`, not a float. A scan's cost is summed across every scan on the
     * stats endpoint, and binary floating point makes that sum depend on the
     * order rows come back in.
     */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),

    /** The canonical report, once there is one. Null while the scan is running. */
    report: jsonb('report'),

    error: jsonb('error'),

    /**
     * For rate limiting and abuse forensics (#19). Never rendered to a user,
     * and it is the reason this table is not something to hand out casually.
     */
    clientIp: text('client_ip'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('scans_status_idx').on(table.status),
    index('scans_created_at_idx').on(table.createdAt),
  ],
);

/**
 * The event log, and the reason `Last-Event-ID` replay can be exact (#17).
 *
 * The primary key is `(scan_id, seq)`, which is not merely an index: it is the
 * database refusing to hold two events numbered 4 for one scan. `seq` is the
 * SSE event id, so a duplicate would make a reconnecting client skip an event
 * it never saw, and that is precisely the failure the key makes impossible.
 */
export const scanEvents = pgTable(
  'scan_events',
  {
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' }).notNull(),
    /** The whole `ScanEvent`, so a replay is byte-identical to the live stream. */
    payload: jsonb('payload').notNull(),
  },
  (table) => [primaryKey({ columns: [table.scanId, table.seq] })],
);

/**
 * Findings as rows.
 *
 * They are also inside `scans.report`, and that duplication is deliberate:
 * findings arrive one at a time while the scan runs, long before a report
 * exists, and the UI filters by tier and criterion without wanting to load a
 * multi-megabyte document to do it. `data` is the finding itself; the columns
 * beside it exist only to be filtered on.
 */
export const findings = pgTable(
  'findings',
  {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    checkId: text('check_id').notNull(),
    scPrimary: text('sc_primary').notNull(),
    tier: text('tier').notNull(),
    severity: text('severity').notNull(),
    pageUrl: text('page_url').notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('findings_scan_idx').on(table.scanId),
    index('findings_tier_idx').on(table.tier),
  ],
);

/**
 * Screenshots and crops.
 *
 * The bytes live in object storage (#22), never in Postgres — this row is the
 * pointer plus the retention clock. `expiresAt` is not decoration: screenshots
 * of arbitrary sites may contain personal data, and the plan commits to a
 * 14-day life for them.
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** Where the bytes are. A filesystem path locally, an object key in R2. */
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('artifacts_scan_idx').on(table.scanId),
    index('artifacts_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Eval runs, for the published scorecard (Phase 3).
 *
 * The table exists now because migrations are cheap to add and awkward to
 * retrofit around live data, and because the scorecard's whole value is the
 * series — a metric first recorded on the day it is published has no trend.
 */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: text('id').primaryKey(),
    /** The commit the numbers describe. */
    gitSha: text('git_sha').notNull(),
    toolVersion: text('tool_version').notNull(),
    mode: text('mode').notNull(),
    /** Precision, recall, F1, hallucination count — the whole scorecard row. */
    metrics: jsonb('metrics').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('eval_runs_created_at_idx').on(table.createdAt)],
);
