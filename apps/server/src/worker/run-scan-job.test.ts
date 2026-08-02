import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  StateCaptureSchema,
  type ArtifactStore,
  type AxeDetectionResult,
  type HeuristicResult,
  type StateCapture,
} from '@handrail/engine';
import type { CaptureRequest, ScanDriver } from '@handrail/orchestrator';
import { ScanOptionsSchema, ScanTargetSchema, scanId as toScanId } from '@handrail/schemas';
import { beforeAll, describe, expect, it } from 'vitest';

import { MemoryArtifactCatalog } from '../artifacts/catalog.js';
import { MemoryObjectStore } from '../artifacts/objects.js';
import { ScanArtifactStore } from '../artifacts/store.js';
import { MemoryScanStore } from '../store/memory.js';
import { runScanJob } from './run-scan-job.js';

const CAPTURE_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/engine/src/judge/__fixtures__/seeded-demo-desktop.capture.json',
);

let capture: StateCapture;

/** A driver that records what it was handed, and never opens a browser. */
function recordingDriver(): ScanDriver & { requests: CaptureRequest[] } {
  return {
    requests: [],
    capture(request: CaptureRequest): Promise<StateCapture> {
      this.requests.push(request);
      return Promise.resolve(capture);
    },
    axe: () =>
      Promise.resolve({ findings: [], passes: [], degradations: [], axeVersion: '4.12.1' } satisfies AxeDetectionResult),
    heuristics: () => Promise.resolve({ outcomes: [], degradations: [] } satisfies HeuristicResult),
    release: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

async function queuedScan(store: MemoryScanStore): Promise<string> {
  const scan = await store.create({
    target: ScanTargetSchema.parse({
      kind: 'url',
      url: capture.url,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
  });
  return scan.id;
}

describe('runScanJob and the artifact store', () => {
  beforeAll(async () => {
    capture = StateCaptureSchema.parse(JSON.parse(await readFile(CAPTURE_FIXTURE, 'utf8')));
  });

  it('hands the scan its own artifact store, so screenshots are actually taken', async () => {
    // The gap #22 closes. Before it, `runScanJob` passed no store at all, so
    // `captureState` skipped screenshots entirely, the `artifacts` table never
    // held a row, and every hosted report had evidence images missing.
    const store = new MemoryScanStore();
    const id = await queuedScan(store);
    const driver = recordingDriver();

    const objects = new MemoryObjectStore();
    const catalog = new MemoryArtifactCatalog();
    let builtFor: string | undefined;

    await runScanJob(
      { scanId: id },
      {
        store,
        createDriver: () => Promise.resolve({ driver, close: () => Promise.resolve() }),
        createArtifactStore: (scanId): ArtifactStore => {
          builtFor = scanId;
          return new ScanArtifactStore({ scanId, objects, catalog });
        },
        toolVersion: '9.9.9-test',
      },
    );

    expect(builtFor).toBe(id);
    expect(driver.requests).not.toHaveLength(0);
    for (const request of driver.requests) expect(request.artifacts).toBeDefined();
  });

  it('builds one store per scan, because the catalog row names the scan', async () => {
    const store = new MemoryScanStore();
    const objects = new MemoryObjectStore();
    const catalog = new MemoryArtifactCatalog();
    const seen: string[] = [];

    for (let index = 0; index < 2; index += 1) {
      const id = await queuedScan(store);
      await runScanJob(
        { scanId: id },
        {
          store,
          createDriver: () =>
            Promise.resolve({ driver: recordingDriver(), close: () => Promise.resolve() }),
          createArtifactStore: (scanId) => {
            seen.push(scanId);
            return new ScanArtifactStore({ scanId, objects, catalog });
          },
          toolVersion: '9.9.9-test',
        },
      );
    }

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
  });

  it('takes no screenshots when the deployment has nowhere to put them', async () => {
    // Not a silent downgrade: the boot log warns, `/readyz` reports it, and the
    // report simply has no evidence images rather than links to bytes nobody
    // kept. This is what a developer's machine looks like.
    const store = new MemoryScanStore();
    const id = await queuedScan(store);
    const driver = recordingDriver();

    await runScanJob(
      { scanId: id },
      {
        store,
        createDriver: () => Promise.resolve({ driver, close: () => Promise.resolve() }),
        createArtifactStore: () => undefined,
        toolVersion: '9.9.9-test',
      },
    );

    for (const request of driver.requests) expect(request.artifacts).toBeUndefined();
    expect((await store.get(toScanId(id)))?.record.status).toBe('completed');
  });
});
