/**
 * The explicit pre-start migration step.
 *
 *     pnpm --filter @handrail/server db:migrate
 *
 * Run before the process starts, never from inside it. Two containers booting
 * at once would otherwise race through the same DDL, and the loser's error is
 * indistinguishable from a real failure.
 *
 * It also creates LangGraph's checkpoint tables, because those are schema too —
 * `PostgresSaver.setup()` is idempotent, but a worker calling it on boot is the
 * same race by another name.
 */
import { closeCheckpointer, createPostgresCheckpointer, setUpCheckpointer } from '@handrail/orchestrator';

import { connect, runMigrations } from '../db/client.js';

const url = process.env.DATABASE_URL;
if (url === undefined || url.length === 0) {
  process.stderr.write('DATABASE_URL is not set; there is nothing to migrate.\n');
  process.exit(1);
}

const database = connect(url, 1);
const checkpointer = createPostgresCheckpointer(url);

try {
  await runMigrations(database.db);
  process.stdout.write('handrail tables are up to date\n');

  await setUpCheckpointer(checkpointer);
  process.stdout.write('checkpoint tables are up to date\n');
} finally {
  await closeCheckpointer(checkpointer);
  await database.close();
}
