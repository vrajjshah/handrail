import type {
  ArtifactId,
  Finding,
  Report,
  ScanEvent,
  ScanId,
  ScanOptions,
  ScanRecord,
  ScanTarget,
} from '@handrail/schemas';

/**
 * The persistence ports.
 *
 * These interfaces are the seam between the HTTP layer and whatever is storing
 * things. #16 ships an in-memory implementation so the API can be built and
 * tested without a database; #18 adds the Drizzle/Postgres one behind the same
 * names. A route that reaches past this interface — for a SQL query, a
 * transaction, a `pg` type — is a route that will have to be rewritten when the
 * storage changes, which is the whole thing this seam exists to prevent.
 */

export interface CreateScanInput {
  target: ScanTarget;
  options: ScanOptions;
  /** For rate limiting and abuse forensics (#19). Never rendered to a user. */
  clientIp?: string;
}

export interface StoredScan {
  record: ScanRecord;
  /** Absent until the scan finishes. */
  report?: Report;
}

export interface ScanStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  /** Wall-clock milliseconds, over completed scans only. */
  durationMs: { p50: number | null; p95: number | null };
  findingsTotal: number;
  costUsdTotal: number;
}

export interface ScanStore {
  create(input: CreateScanInput): Promise<ScanRecord>;
  get(id: ScanId): Promise<StoredScan | undefined>;
  /** Patch a scan's mutable fields. Returns undefined when the scan is unknown. */
  update(id: ScanId, patch: Partial<ScanRecord>): Promise<ScanRecord | undefined>;
  saveReport(id: ScanId, report: Report): Promise<void>;
  stats(): Promise<ScanStats>;

  /**
   * Append events for a scan.
   *
   * Takes an array because ordering is the contract: `seq` is the SSE event id,
   * and a caller that appends one at a time across await points can interleave
   * two writes and produce a stream that is well-ordered nowhere. #17 reads
   * these back for `Last-Event-ID` replay.
   */
  appendEvents(id: ScanId, events: readonly ScanEvent[]): Promise<void>;
  /** Events with `seq > afterSeq`, ascending. `afterSeq: -1` returns all of them. */
  eventsSince(id: ScanId, afterSeq: number): Promise<ScanEvent[]>;
  /**
   * The highest `seq` written, or -1 when there are none.
   *
   * A resumed scan continues the sequence from here. Starting again at 0 would
   * mint a second event 4 for one scan, and `seq` is the SSE event id.
   */
  lastSeq(id: ScanId): Promise<number>;

  /**
   * Persist findings as they stream, before any report exists.
   *
   * Ids are content-derived, so re-saving one after a resume is expected and
   * must be harmless.
   */
  saveFindings(id: ScanId, findings: readonly Finding[]): Promise<void>;

  /**
   * When this address started scans, since `since`.
   *
   * Timestamps rather than a count, because the rate limit is a sliding window
   * and the only honest answer to "when can I try again" is when the oldest one
   * ages out. A counter in a bucket cannot say.
   */
  recentScanTimesForIp(clientIp: string, since: Date): Promise<Date[]>;

  /** Scans currently running, across the whole deployment. */
  countRunning(): Promise<number>;
}

/**
 * Binary artifacts — screenshots, crops.
 *
 * Deliberately the same read shape as `@handrail/engine`'s `ArtifactStore`, so
 * the store the scan writes into is the store the API reads from without an
 * adapter in between. #22 puts R2 behind it.
 */
export interface ArtifactReader {
  get(id: ArtifactId): Promise<Buffer>;
  /**
   * A time-limited URL for these bytes, or `undefined` when this store cannot
   * mint one.
   *
   * Required, not optional — every implementation has to answer the question,
   * and `undefined` is a real answer that the route handles rather than a
   * capability check somebody forgets to write. The in-memory store returns it;
   * the R2-backed one returns a presigned GET good for a few minutes.
   *
   * Throws {@link ArtifactNotFoundError} or {@link ArtifactExpiredError} for
   * the same reasons {@link ArtifactReader.get} does: refusing to mint a
   * capability is part of the retention policy, not a rendering detail.
   */
  signedUrl(id: ArtifactId): Promise<string | undefined>;
}

/** Thrown by a reader when the id is not one it holds. Routes turn this into a 404. */
export class ArtifactNotFoundError extends Error {
  readonly artifactId: string;

  constructor(id: string) {
    super(`no such artifact: ${id}`);
    this.name = 'ArtifactNotFoundError';
    this.artifactId = id;
  }
}

/**
 * Thrown when the artifact existed and its retention window has closed.
 *
 * Distinct from "not found", and routes answer it with `410 Gone`: a screenshot
 * that has aged out is not a typo in a URL, and a client that cannot tell the
 * two apart will keep retrying one of them forever. It is also the honest thing
 * to say about a deployment that deletes personal data on a schedule.
 */
export class ArtifactExpiredError extends Error {
  readonly artifactId: string;
  readonly expiresAt: Date;

  constructor(id: string, expiresAt: Date) {
    super(`artifact ${id} expired at ${expiresAt.toISOString()}`);
    this.name = 'ArtifactExpiredError';
    this.artifactId = id;
    this.expiresAt = expiresAt;
  }
}
