import { launchChromium, type ArtifactStore, type Browser } from '@handrail/engine';
import {
  createPlaywrightDriver,
  createPostgresCheckpointer,
  type ScanCheckpointer,
  type ScanDriver,
} from '@handrail/orchestrator';
import type { ScanId } from '@handrail/schemas';

import type { ArtifactCatalog } from './artifacts/catalog.js';
import { PostgresArtifactCatalog } from './artifacts/postgres-catalog.js';
import { R2ObjectStore } from './artifacts/r2.js';
import { CatalogArtifactReader, ScanArtifactStore } from './artifacts/store.js';
import { r2ConfigFrom, type Config } from './config.js';
import { connect, type DatabaseHandle } from './db/client.js';
import { MemoryEventBus, type ScanEventBus } from './events/bus.js';
import type { ReadinessCheck } from './health/checks.js';
import { chromiumCheck, databaseCheck, objectStorageCheck, queueCheck } from './health/probes.js';
import { PostgresEventBus } from './events/postgres-bus.js';
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
  /**
   * The store a scan writes screenshots into, built per scan.
   *
   * `undefined` when this deployment has no object storage — the scan then
   * takes no screenshots and the report says so, which is what a developer's
   * machine looks like and what every hosted scan looked like before #22.
   */
  createArtifactStore: (scanId: ScanId) => ArtifactStore | undefined;
  queue: ScanQueue | undefined;
  eventBus: ScanEventBus;
  /** What `/readyz` proves for this deployment. */
  readiness: ReadinessCheck[];
  checkpointer: ScanCheckpointer | undefined;
  database: DatabaseHandle | undefined;
  /** True when nothing survives a restart. Reported, never hidden. */
  ephemeral: boolean;
  /** True when screenshots are captured and kept. Reported at boot and by `/readyz`. */
  storesArtifacts: boolean;
  close: () => Promise<void>;
}

export function buildRuntime(config: Config): Runtime {
  if (config.NODE_ENV === 'production' && config.ADMIN_TOKEN === undefined) {
    // Not fatal — a public demo with no admin bypass is a valid deployment —
    // but silence here is how a rate limit gets turned off "temporarily".
    process.stderr.write(
      'ADMIN_TOKEN is not set: nothing can bypass the rate limits on this deployment.\n',
    );
  }

  if (config.DATABASE_URL === undefined) {
    // Not a fallback in the forbidden sense — nothing is silently degraded.
    // The caller logs it, `/readyz` reports it, and no scan runs, because
    // there is no queue to carry one.
    const eventBus = new MemoryEventBus();
    return {
      store: new MemoryScanStore({ bus: eventBus }),
      artifacts: new MemoryArtifactReader(),
      // No database means no catalog to write a row into, so no screenshots
      // either. The two travel together: bytes with nothing pointing at them
      // are bytes nobody can find and nobody will delete.
      createArtifactStore: () => undefined,
      queue: undefined,
      eventBus,
      // No database and no queue to check. Chromium still is: without it this
      // process could not run a scan even if the rest arrived.
      readiness: [chromiumCheck()],
      checkpointer: undefined,
      database: undefined,
      ephemeral: true,
      storesArtifacts: false,
      close: () => eventBus.close(),
    };
  }

  const database = connect(config.DATABASE_URL);
  const queue = new PgBossQueue({
    connectionString: config.DATABASE_URL,
    concurrency: config.WORKER_CONCURRENCY,
    expireInSeconds: config.JOB_EXPIRE_SECONDS,
  });

  // The bus notifies through the pool and listens on a connection of its own —
  // a `LISTEN` on a pooled connection belongs to whoever borrows it next.
  const eventBus = new PostgresEventBus({
    connectionString: config.DATABASE_URL,
    pool: database.pool,
  });

  // Throws on a partial set; `assertRunnable` has already run it at boot.
  const r2 = r2ConfigFrom(config);
  const objects: R2ObjectStore | undefined = r2 === undefined ? undefined : new R2ObjectStore(r2);
  const catalog: ArtifactCatalog = new PostgresArtifactCatalog(database.db);

  return {
    store: new PostgresScanStore(database.db, { bus: eventBus }),
    artifacts:
      objects === undefined
        ? new MemoryArtifactReader()
        : new CatalogArtifactReader({ objects, catalog }),
    createArtifactStore:
      objects === undefined
        ? () => undefined
        : (scanId) => new ScanArtifactStore({ scanId, objects, catalog }),
    queue,
    eventBus,
    readiness: [
      databaseCheck(database.db),
      queueCheck(queue),
      chromiumCheck(),
      // Only when it is configured. A deployment without object storage is not
      // unready; one that was told where its bucket is and cannot reach it is,
      // because every report it produces will be missing its evidence.
      ...(objects === undefined ? [] : [objectStorageCheck(objects)]),
    ],
    checkpointer: createPostgresCheckpointer(config.DATABASE_URL),
    database,
    ephemeral: false,
    storesArtifacts: objects !== undefined,
    close: async () => {
      await queue.stop();
      await eventBus.close();
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
