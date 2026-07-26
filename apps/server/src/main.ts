/**
 * The process entry point.
 *
 * Everything interesting is in `buildServer`, which returns an app rather than
 * listening on one — that is what lets the whole API be tested with `inject()`
 * and no socket. This file exists to read the environment, choose the store,
 * and handle the signals a container sends.
 */
import { buildServer } from './app.js';
import { loadConfig, servesHttp } from './config.js';
import { MemoryArtifactReader, MemoryScanStore } from './store/memory.js';
import { HANDRAIL_VERSION } from './version.js';

const config = loadConfig();

if (!servesHttp(config)) {
  process.stderr.write(
    `SERVICE_ROLE=${config.SERVICE_ROLE} does not serve HTTP, and the worker lands in #18.\n`,
  );
  process.exit(1);
}

// Postgres arrives in #18. Until then the store is in-memory, and it says so
// rather than pretending a restart is survivable.
const app = await buildServer({
  config,
  store: new MemoryScanStore(),
  artifacts: new MemoryArtifactReader(),
  toolVersion: HANDRAIL_VERSION,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(
  { role: config.SERVICE_ROLE, store: 'memory' },
  'scans are held in memory and will not survive a restart until #18',
);
