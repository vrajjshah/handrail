/**
 * The process entry point.
 *
 * Everything interesting is in `buildServer` and `buildRuntime`, which return
 * things rather than starting them — that is what lets the whole API be tested
 * with `inject()` and no socket. This file reads the environment, decides which
 * halves of the image to run, and handles the signals a container sends.
 */
import { buildServer } from './app.js';
import { assertRunnable, loadConfig, runsScans, servesHttp } from './config.js';
import { buildRuntime, createScanDriver } from './composition.js';
import { runScanJob } from './worker/run-scan-job.js';
import { HANDRAIL_VERSION } from './version.js';

const config = loadConfig();
assertRunnable(config);

const runtime = buildRuntime(config);

const app = await buildServer({
  config,
  store: runtime.store,
  artifacts: runtime.artifacts,
  toolVersion: HANDRAIL_VERSION,
  eventBus: runtime.eventBus,
  readiness: runtime.readiness,
  ...(runtime.queue === undefined ? {} : { queue: runtime.queue }),
});

if (runtime.ephemeral) {
  app.log.warn(
    'DATABASE_URL is not set: scans are held in memory, nothing survives a restart, ' +
      'and no worker will run them. Set it, then run `db:migrate`.',
  );
}

if (runsScans(config) && runtime.queue !== undefined) {
  await runtime.queue.work(async (payload) => {
    const result = await runScanJob(payload, {
      store: runtime.store,
      createDriver: createScanDriver,
      ...(runtime.checkpointer === undefined ? {} : { checkpointer: runtime.checkpointer }),
      toolVersion: HANDRAIL_VERSION,
    });
    app.log.info({ correlationId: result.scanId, ...result }, 'scan job finished');
  });
  app.log.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker consuming the scan queue');
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    // The queue stops gracefully, so a scan in flight finishes rather than
    // orphaning a browser — and if it cannot finish, its job returns to the
    // queue and the next worker resumes it from its checkpoint.
    void (async () => {
      try {
        await app.close();
        await runtime.close();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    })();
  });
}

if (servesHttp(config)) {
  await app.listen({ host: config.HOST, port: config.PORT });
} else {
  app.log.info({ role: config.SERVICE_ROLE }, 'worker-only process: not listening for HTTP');
}
