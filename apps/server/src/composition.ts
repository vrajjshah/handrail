import { launchChromium, type Browser } from '@handrail/engine';
import {
  createPlaywrightDriver,
  createPostgresCheckpointer,
  type ScanCheckpointer,
  type ScanDriver,
} from '@handrail/orchestrator';

import type { Config } from './config.js';
import { connect, type DatabaseHandle } from './db/client.js';
import { MemoryArtifactReader, MemoryScanStore } from './store/memory.js';
import { PostgresScanStore } from './store/postgres.js';
import type { ArtifactReader, ScanStore } from './store/types.js';
import { PgBossQueue, type ScanQueue } from './worker/queue.js';

/**
 * The composition root: the one place that knows which implementations are in
 * play, and the only place that reads `DATABASE_URL`.
 *
 * Every layer below takes its collaborators as parameters, which is what lets
 * the whole API be tested with `inject()` and no database. Assembling that here
 * — rather than importing a singleton from six modules — is what keeps that
 * true as the system grows.
 */
export interface Runtime {
  store: ScanStore;
  artifacts: ArtifactReader;
  queue: ScanQueue | undefined;
  checkpointer: ScanCheckpointer | undefined;
  database: DatabaseHandle | undefined;
  /** True when nothing survives a restart. Reported, never hidden. */
  ephemeral: boolean;
  close: () => Promise<void>;
}

export function buildRuntime(config: Config): Runtime {
  if (config.DATABASE_URL === undefined) {
    // Not a fallback in the forbidden sense — nothing is silently degraded.
    // The caller logs it, `/readyz` reports it, and no scan runs, because
    // there is no queue to carry one.
    return {
      store: new MemoryScanStore(),
      artifacts: new MemoryArtifactReader(),
      queue: undefined,
      checkpointer: undefined,
      database: undefined,
      ephemeral: true,
      close: () => Promise.resolve(),
    };
  }

  const database = connect(config.DATABASE_URL);
  const queue = new PgBossQueue({
    connectionString: config.DATABASE_URL,
    concurrency: config.WORKER_CONCURRENCY,
    expireInSeconds: config.JOB_EXPIRE_SECONDS,
  });

  return {
    store: new PostgresScanStore(database.db),
    artifacts: new MemoryArtifactReader(),
    queue,
    checkpointer: createPostgresCheckpointer(config.DATABASE_URL),
    database,
    ephemeral: false,
    close: async () => {
      await queue.stop();
      await database.close();
    },
  };
}

/**
 * A browser per scan.
 *
 * Not one held open for the process's lifetime: Chromium's memory use grows
 * across pages of arbitrary sites, and a worker that leaks it dies in a way
 * that looks like a scan bug. The cost of a launch is seconds against a scan
 * measured in minutes.
 */
export async function createScanDriver(): Promise<{
  driver: ScanDriver;
  close: () => Promise<void>;
}> {
  const browser: Browser = await launchChromium();
  return { driver: createPlaywrightDriver(browser), close: () => browser.close() };
}
