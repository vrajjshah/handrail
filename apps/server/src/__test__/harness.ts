import {
  FindingSchema,
  ReportSchema,
  ScanOptionsSchema,
  ScanTargetSchema,
  findingId,
  pageStateId,
  scanId as toScanId,
  type Finding,
  type FindingInput,
  type Report,
  type ScanId,
} from '@handrail/schemas';
import { buildReport } from '@handrail/engine';
import type { FastifyInstance } from 'fastify';

import { buildServer, type ServerDeps } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryArtifactReader, MemoryScanStore } from '../store/memory.js';

/**
 * A server wired to in-memory stores, driven through `inject()`.
 *
 * No socket is opened and no database is needed, which is what keeps the API
 * suite in the three-OS `unit` job rather than in an ubuntu-only one.
 */
export interface Harness {
  app: FastifyInstance;
  store: MemoryScanStore;
  artifacts: MemoryArtifactReader;
}

export async function harness(overrides: Partial<ServerDeps> = {}): Promise<Harness> {
  const store = new MemoryScanStore();
  const artifacts = new MemoryArtifactReader();
  const app = await buildServer({
    config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    store,
    artifacts,
    toolVersion: '9.9.9-test',
    ...overrides,
  });
  return { app, store, artifacts };
}

export function testFinding(overrides: Partial<FindingInput> = {}): Finding {
  return FindingSchema.parse({
    id: findingId('find_1'),
    checkId: 'axe.image-alt',
    source: 'axe',
    sc: ['1.1.1'],
    scPrimary: '1.1.1',
    tier: 'violation',
    severity: 'critical',
    confidence: 1,
    evidence: [{ kind: 'tool', tool: 'axe-core', ruleId: 'image-alt', output: 'no alt attribute' }],
    element: { selector: 'img' },
    page: { url: 'https://example.com/', pageStateId: pageStateId('st_1'), viewport: 'desktop' },
    verification: { method: 'none', status: 'unverified' },
    description: 'Image has no text alternative.',
    ...overrides,
  } satisfies FindingInput);
}

/** Put a completed scan with a report into the store, the way a worker would. */
export async function completeScan(
  harnessed: Harness,
  findings: readonly Finding[] = [],
): Promise<{ id: ScanId; report: Report }> {
  const created = await harnessed.store.create({
    target: ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
  });

  const record = await harnessed.store.update(created.id, {
    status: 'completed',
    phase: 'report',
    startedAt: '2026-07-25T10:00:00.000Z',
    finishedAt: '2026-07-25T10:00:20.000Z',
  });
  if (record === undefined) throw new Error('the scan vanished between create and update');

  const report = ReportSchema.parse(
    buildReport({
      scan: record,
      findings,
      toolVersion: '9.9.9-test',
      generatedAt: new Date('2026-07-25T10:00:20.000Z'),
    }),
  );
  await harnessed.store.saveReport(created.id, report);
  return { id: toScanId(created.id), report };
}
