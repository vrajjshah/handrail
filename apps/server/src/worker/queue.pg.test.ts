import { afterEach, describe, expect, it } from 'vitest';

import { PgBossQueue } from './queue.js';
import type { ScanJobPayload } from './run-scan-job.js';

const DATABASE_URL = process.env.DATABASE_URL;

/** Wait for a condition, or give up. Polling beats an arbitrary sleep. */
async function until(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for the queue');
}

describe.skipIf(DATABASE_URL === undefined)('PgBossQueue', () => {
  const queues: PgBossQueue[] = [];

  function queue(): PgBossQueue {
    const created = new PgBossQueue({
      connectionString: DATABASE_URL ?? '',
      concurrency: 1,
      // Short, so a test that leaves a job behind does not wedge the next run.
      expireInSeconds: 60,
      retryLimit: 0,
    });
    queues.push(created);
    return created;
  }

  afterEach(async () => {
    while (queues.length > 0) await queues.pop()?.stop();
  });

  it('delivers a published job to a worker', async () => {
    const producer = queue();
    const consumer = queue();
    const seen: ScanJobPayload[] = [];

    await consumer.work((payload) => {
      seen.push(payload);
      return Promise.resolve();
    });

    const scanId = `scan_queue_${String(Date.now())}`;
    expect(await producer.publish({ scanId })).not.toBeNull();

    await until(() => seen.length > 0);
    expect(seen[0]?.scanId).toBe(scanId);
  });

  it('refuses to enqueue the same scan twice', async () => {
    // The payload carries only the scan id, so a second send is a duplicate
    // scan rather than more work — `singletonKey` makes the queue say so.
    const producer = queue();
    const scanId = `scan_dupe_${String(Date.now())}`;
    expect(await producer.publish({ scanId })).not.toBeNull();
    expect(await producer.publish({ scanId })).toBeNull();
  });

  it('reports itself healthy once its schema exists', async () => {
    expect(await queue().healthy()).toBe(true);
  });

  it('reports unhealthy against a database it cannot reach', async () => {
    // `/readyz` (#20) depends on this being a `false` rather than a hang.
    const broken = new PgBossQueue({
      connectionString: 'postgresql://nobody:nobody@127.0.0.1:1/nothing',
    });
    expect(await broken.healthy()).toBe(false);
  });
});
