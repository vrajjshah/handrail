import { MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/**
 * Checkpointing, behind a name a surface can hold.
 *
 * The plan chose LangGraph partly for "Postgres checkpointing riding our DB",
 * and this is where that arrives. It matters because a scan is minutes long: a
 * worker that dies during `judge-text` has already paid for the captures and
 * the detection, and starting over would spend that money twice.
 *
 * The type is opaque on purpose. A checkpointer is a `BaseCheckpointSaver`, but
 * naming that type outside this package would put `@langchain/*` in a surface's
 * type graph and quietly break the layering rule that `layering.test.ts`
 * enforces — the dependency would be real even though no import statement
 * mentioned it.
 */
export interface ScanCheckpointer {
  /** Present so the type is not structurally `{}`, which anything satisfies. */
  readonly __handrailCheckpointer: unique symbol;
}

/** The saver, as the graph needs it. Internal to this package. */
export type CheckpointSaver = MemorySaver | PostgresSaver;

function opaque(saver: CheckpointSaver): ScanCheckpointer {
  return saver as unknown as ScanCheckpointer;
}

export function toSaver(checkpointer: ScanCheckpointer): CheckpointSaver {
  return checkpointer as unknown as CheckpointSaver;
}

/**
 * A Postgres-backed checkpointer.
 *
 * `setup()` creates its tables and is idempotent, but it is **not** called
 * here: schema creation is a migration-time concern, and a worker that quietly
 * DDLs its own database on boot is a worker that can race another one doing the
 * same. {@link setUpCheckpointer} exists for the migration step to call.
 */
export function createPostgresCheckpointer(connectionString: string): ScanCheckpointer {
  return opaque(PostgresSaver.fromConnString(connectionString));
}

/** Create the checkpointer's tables. Idempotent; call it from the migration step. */
export async function setUpCheckpointer(checkpointer: ScanCheckpointer): Promise<void> {
  const saver = toSaver(checkpointer);
  if (saver instanceof PostgresSaver) await saver.setup();
}

/** Release the checkpointer's connections. */
export async function closeCheckpointer(checkpointer: ScanCheckpointer): Promise<void> {
  const saver = toSaver(checkpointer);
  if (saver instanceof PostgresSaver) await saver.end();
}

/**
 * An in-memory checkpointer.
 *
 * Enough to prove that a resumed graph does not re-run completed nodes, which
 * is the property worth testing everywhere rather than only where a database
 * is available. It cannot prove survival across a process restart — that needs
 * the Postgres one, and has its own integration test.
 */
export function createMemoryCheckpointer(): ScanCheckpointer {
  return opaque(new MemorySaver());
}
