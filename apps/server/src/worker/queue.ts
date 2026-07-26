// A named export, not a default: pg-boss 12 ships ESM types and `import PgBoss
// from 'pg-boss'` typechecks against nothing.
import { PgBoss, type Job } from 'pg-boss';

import type { ScanJobPayload } from './run-scan-job.js';

export const SCAN_QUEUE = 'scan';

/**
 * The queue.
 *
 * pg-boss keeps its jobs in the Postgres we are already paying for, in its own
 * `pgboss` schema. No Redis, one backing store, one thing to back up — and a
 * job and the scan it refers to can be reasoned about in the same database.
 */
export interface ScanQueue {
  /** Enqueue a scan. Returns the job id, or null when the job was deduplicated. */
  publish(payload: ScanJobPayload): Promise<string | null>;
  /** Start consuming. Only a process whose `SERVICE_ROLE` runs scans calls this. */
  work(handler: (payload: ScanJobPayload) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** For `/readyz` (#20): the queue is reachable and its schema is present. */
  healthy(): Promise<boolean>;
}

export interface QueueOptions {
  connectionString: string;
  /**
   * 1–2, per the plan. A scan drives a real browser: the constraint is memory
   * and CPU on a small container, not queue throughput, and a worker that
   * accepts ten scans at once finishes none of them.
   */
  concurrency?: number;
  /**
   * How long a worker may hold a job before the queue assumes it died.
   *
   * This is the number that makes "survives a worker restart" true, and it has
   * to exceed the longest scan the budget allows — 10 minutes — or a slow scan
   * gets handed to a second worker while the first is still running it.
   */
  expireInSeconds?: number;
  retryLimit?: number;
}

export class PgBossQueue implements ScanQueue {
  private readonly boss: PgBoss;
  private readonly options: Required<Omit<QueueOptions, 'connectionString'>>;
  private started = false;

  constructor(options: QueueOptions) {
    this.boss = new PgBoss({ connectionString: options.connectionString });
    this.options = {
      concurrency: options.concurrency ?? 1,
      expireInSeconds: options.expireInSeconds ?? 15 * 60,
      retryLimit: options.retryLimit ?? 2,
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    // `short` + `singletonKey` is what makes a duplicate submission a no-op:
    // at most one *waiting* job per key. `singletonKey` on its own does nothing
    // under the default `standard` policy, which is a quiet way to believe you
    // have deduplication and not have it.
    await this.boss.createQueue(SCAN_QUEUE, { policy: 'short' });
    this.started = true;
  }

  async publish(payload: ScanJobPayload): Promise<string | null> {
    await this.ensureStarted();
    return this.boss.send(SCAN_QUEUE, payload, {
      expireInSeconds: this.options.expireInSeconds,
      retryLimit: this.options.retryLimit,
      // Linear rather than exponential: a scan fails because a site was slow or
      // a browser died, and neither gets better by waiting an hour.
      retryDelay: 15,
      // The scan id is already unique and the payload carries only that, so a
      // duplicated send is a duplicate scan — which the queue can refuse.
      singletonKey: payload.scanId,
    });
  }

  async work(handler: (payload: ScanJobPayload) => Promise<void>): Promise<void> {
    await this.ensureStarted();
    await this.boss.work<ScanJobPayload>(
      SCAN_QUEUE,
      { batchSize: this.options.concurrency },
      async (jobs: Job<ScanJobPayload>[]) => {
        // Sequential, even at concurrency 2: `batchSize` bounds how many jobs
        // one fetch may claim, and running a batch in parallel would put two
        // browsers in a container sized for one.
        for (const job of jobs) await handler(job.data);
      },
    );
  }

  async healthy(): Promise<boolean> {
    try {
      await this.ensureStarted();
      await this.boss.getQueue(SCAN_QUEUE);
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    // `graceful` lets an in-flight scan finish rather than orphaning a browser.
    await this.boss.stop({ graceful: true });
    this.started = false;
  }
}
