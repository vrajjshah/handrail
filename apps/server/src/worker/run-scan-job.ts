import type { ArtifactStore } from '@handrail/engine';
import { isTerminalEvent, type Finding, type ScanEvent, type ScanId } from '@handrail/schemas';
import {
  streamScan,
  type ScanCheckpointer,
  type ScanDriver,
  type ScanGraphDeps,
} from '@handrail/orchestrator';

import type { ScanStore } from '../store/types.js';

export interface ScanJobPayload {
  scanId: string;
}

export interface RunScanJobDeps {
  store: ScanStore;
  /** Built per job: a browser is not something to hold open between scans. */
  createDriver: () => Promise<{ driver: ScanDriver; close: () => Promise<void> }>;
  checkpointer?: ScanCheckpointer;
  /**
   * Where this scan's screenshots go. Built per scan, because the catalog row
   * records which scan produced each artifact.
   *
   * Omit — or return `undefined` — and the scan takes no screenshots at all.
   * That is the honest shape for a deployment with no object storage: the
   * report says it has no evidence images rather than linking to bytes nobody
   * kept. It was also, until this issue, the *only* shape the hosted scan had.
   */
  createArtifactStore?: (scanId: ScanId) => ArtifactStore | undefined;
  toolVersion: string;
  now?: () => Date;
  /** How many events to batch before writing. Small: the SSE stream reads these. */
  flushEvery?: number;
}

export interface ScanJobResult {
  scanId: ScanId;
  status: 'completed' | 'failed';
  resumed: boolean;
  findings: number;
}

/**
 * Run one scan job to completion, persisting as it goes.
 *
 * Two properties make the restart story work, and both are here rather than in
 * the queue:
 *
 * 1. **Events and findings are written while the scan runs**, not at the end.
 *    A scan that dies at minute nine has still told the database everything it
 *    learned in the first eight, which is what a reconnecting SSE client reads.
 * 2. **The job decides whether it is starting or resuming**, by asking the
 *    store whether this scan has already emitted anything. pg-boss will hand
 *    the same job to a second worker after the first one dies; without this it
 *    would silently pay for every capture twice.
 */
export async function runScanJob(
  payload: ScanJobPayload,
  deps: RunScanJobDeps,
): Promise<ScanJobResult> {
  const now = deps.now ?? (() => new Date());
  const scanId = payload.scanId as ScanId;
  const stored = await deps.store.get(scanId);
  if (stored === undefined) throw new Error(`no scan with id ${payload.scanId}`);

  const lastSeq = await deps.store.lastSeq(scanId);
  // Anything already emitted means a previous attempt got somewhere. Resuming
  // is only possible with a checkpointer; without one the honest thing is to
  // start over rather than to claim a resume that cannot happen.
  const resumed = lastSeq >= 0 && deps.checkpointer !== undefined;

  await deps.store.update(scanId, {
    status: 'running',
    ...(stored.record.startedAt === undefined ? { startedAt: now().toISOString() } : {}),
  });

  const handle = await deps.createDriver();
  const artifacts = deps.createArtifactStore?.(scanId);
  const graphDeps: ScanGraphDeps = {
    driver: handle.driver,
    ...(deps.checkpointer === undefined ? {} : { checkpointer: deps.checkpointer }),
    ...(artifacts === undefined ? {} : { artifacts }),
  };

  const buffer: ScanEvent[] = [];
  const findings: Finding[] = [];
  const flushEvery = deps.flushEvery ?? 10;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    await deps.store.appendEvents(scanId, batch);
    const batched = findings.splice(0, findings.length);
    if (batched.length > 0) await deps.store.saveFindings(scanId, batched);
  };

  try {
    const stream = streamScan(
      {
        scanId,
        target: stored.record.target,
        options: stored.record.options,
        toolVersion: deps.toolVersion,
        resume: resumed,
        startSeq: lastSeq + 1,
      },
      graphDeps,
    );

    let step = await stream.next();
    while (!step.done) {
      const event = step.value;
      buffer.push(event);
      if (event.type === 'finding.detected') findings.push(event.finding);
      // Terminal events flush immediately: a client waiting on the stream should
      // not learn the scan finished on the next batch boundary.
      if (buffer.length >= flushEvery || isTerminalEvent(event)) await flush();
      step = await stream.next();
    }
    await flush();

    const result = step.value;
    await deps.store.saveReport(scanId, result.report);
    await deps.store.update(scanId, {
      status: 'completed',
      phase: 'report',
      counts: result.record.counts,
      costUsd: result.record.costUsd,
      degradations: result.record.degradations,
      finishedAt: now().toISOString(),
    });

    return { scanId, status: 'completed', resumed, findings: result.findings.length };
  } catch (error) {
    // Whatever was learned before the failure is already written; this records
    // why it stopped. The scan is `failed`, never quietly `completed` with less
    // in it — trust invariant 1 applied to the job runner.
    await flush();
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.update(scanId, {
      status: 'failed',
      finishedAt: now().toISOString(),
      error: { code: 'scan-failed', message: message.slice(0, 4000) },
    });
    throw error;
  } finally {
    await handle.close();
  }
}
