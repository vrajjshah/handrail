import { launchChromium } from '@handrail/engine';
import { sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import type { ScanQueue } from '../worker/queue.js';
import { cacheSuccess, type ReadinessCheck } from './checks.js';

/** Postgres answers, and it is the database we think it is. */
export function databaseCheck(db: Database): ReadinessCheck {
  return {
    name: 'postgres',
    timeoutMs: 5_000,
    run: async () => {
      // `select 1` proves a connection. Reading from `scans` proves the
      // migrations ran, which is the failure that actually happens: a fresh
      // container pointed at an un-migrated database connects perfectly and
      // then fails every write.
      await db.execute(sql`select count(*) from scans`);
      return 'connected, schema present';
    },
  };
}

/** pg-boss is started and its queue exists. */
export function queueCheck(queue: ScanQueue): ReadinessCheck {
  return {
    name: 'queue',
    timeoutMs: 5_000,
    run: async () => {
      if (!(await queue.healthy())) throw new Error('the scan queue is not reachable');
      return 'scan queue reachable';
    },
  };
}

/**
 * The artifact bucket exists and these credentials can reach it.
 *
 * Registered only when R2 is configured. The distinction matters: a deployment
 * with no object storage takes no screenshots and is perfectly ready, while one
 * that was told where its bucket is and cannot reach it will complete every
 * scan and produce a report with no evidence in it. `/readyz` gates the
 * platform healthcheck, so this is what keeps a container with bad R2
 * credentials from being promoted over one that works.
 *
 * Cached on success like the Chromium check, and for the same reason: a
 * platform polls readiness far more often than a bucket changes.
 */
export function objectStorageCheck(
  store: { head: () => Promise<void>; bucketName: string },
  options: { ttlMs?: number } = {},
): ReadinessCheck {
  return cacheSuccess(
    {
      name: 'object-storage',
      timeoutMs: 5_000,
      run: async () => {
        await store.head();
        return `bucket ${store.bucketName} reachable`;
      },
    },
    options.ttlMs ?? 30_000,
  );
}

/**
 * Chromium actually launches.
 *
 * The check that makes `/readyz` mean something. Everything else can be green
 * on a container with no browser binary, no shared libraries, or no memory left
 * to fork one — and every scan will still fail. A launch is the only thing that
 * proves otherwise, so the check launches.
 *
 * Cached on success for `ttlMs`, because a platform polls readiness far more
 * often than a browser can be opened. Never cached on failure.
 */
export function chromiumCheck(
  options: { launch?: () => Promise<{ close: () => Promise<void> }>; ttlMs?: number } = {},
): ReadinessCheck {
  const launch = options.launch ?? (() => launchChromium());

  return cacheSuccess(
    {
      name: 'chromium',
      // Generous: a cold container's first launch is slow, and calling that
      // unready would make a deploy flap.
      timeoutMs: 20_000,
      run: async () => {
        const browser = await launch();
        try {
          return 'chromium launched';
        } finally {
          // Always closed. A readiness probe that leaks a browser every few
          // seconds is a memory leak with a green tick next to it.
          await browser.close();
        }
      },
    },
    options.ttlMs ?? 30_000,
  );
}
