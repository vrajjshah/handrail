import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  StateCaptureSchema,
  type AxeDetectionResult,
  type HeuristicResult,
  type StateCapture,
} from '@handrail/engine';
import { ScanOptionsSchema, ScanTargetSchema, scanId, type ScanEvent } from '@handrail/schemas';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMemoryCheckpointer } from './checkpoint.js';
import type { CaptureRequest, ScanDriver } from './driver.js';
import { streamScan, type ScanGraphDeps } from './graph.js';

const CAPTURE_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../engine/src/judge/__fixtures__/seeded-demo-desktop.capture.json',
);

let capture: StateCapture;

beforeAll(async () => {
  capture = StateCaptureSchema.parse(JSON.parse(await readFile(CAPTURE_FIXTURE, 'utf8')));
});

interface CountingDriver extends ScanDriver {
  captures: number;
  axeRuns: number;
}

/**
 * A driver that counts, and can be told to fail once.
 *
 * The counts are the assertion: "resumed from its checkpoint" means the work
 * already paid for is not paid for twice, and the only honest way to check that
 * is to watch whether the expensive calls happen again.
 */
function countingDriver(failAxeOnce = false): CountingDriver {
  let shouldFail = failAxeOnce;
  return {
    captures: 0,
    axeRuns: 0,
    capture(_request: CaptureRequest): Promise<StateCapture> {
      this.captures += 1;
      return Promise.resolve(capture);
    },
    axe(): Promise<AxeDetectionResult> {
      this.axeRuns += 1;
      if (shouldFail) {
        shouldFail = false;
        return Promise.reject(new Error('the worker died mid-scan'));
      }
      return Promise.resolve({
        findings: [],
        passes: [],
        degradations: [],
        axeVersion: '4.12.1',
      });
    },
    heuristics(): Promise<HeuristicResult> {
      return Promise.resolve({ outcomes: [], degradations: [] });
    },
    release(): Promise<void> {
      return Promise.resolve();
    },
    dispose(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function input(overrides: { resume?: boolean; startSeq?: number } = {}) {
  return {
    scanId: scanId('scan_resume_test'),
    target: ScanTargetSchema.parse({
      kind: 'url',
      url: capture.url,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
    ...overrides,
  };
}

async function drain(
  deps: ScanGraphDeps,
  args: ReturnType<typeof input>,
): Promise<{ events: ScanEvent[]; error?: Error }> {
  const events: ScanEvent[] = [];
  try {
    const stream = streamScan(args, deps);
    let step = await stream.next();
    while (!step.done) {
      events.push(step.value);
      step = await stream.next();
    }
    return { events };
  } catch (error) {
    return { events, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

describe('resuming a checkpointed scan', () => {
  it('does not re-run the phases that already completed', async () => {
    const checkpointer = createMemoryCheckpointer();

    // First attempt: crawl and capture succeed, detect throws — the shape of a
    // worker dying part-way through.
    const first = countingDriver(true);
    const failed = await drain({ driver: first, checkpointer }, input());
    expect(failed.error?.message).toContain('the worker died mid-scan');
    expect(first.captures).toBe(1);

    // A second worker picks the job up. Same thread, `resume: true`.
    const second = countingDriver();
    const resumed = await drain(
      { driver: second, checkpointer },
      input({ resume: true, startSeq: failed.events.length }),
    );

    expect(resumed.error).toBeUndefined();
    // The capture is the expensive part, and it does not happen again.
    expect(second.captures).toBe(0);
    // Detect is re-run, because it is the node that failed. That is the
    // granularity a node-level checkpoint gives you, and it is the honest
    // claim: completed nodes are skipped, the failed one is retried.
    expect(second.axeRuns).toBe(1);

    const completed = resumed.events.filter((e) => e.type === 'phase.completed').map((e) => e.phase);
    expect(completed).not.toContain('crawl');
    expect(completed).not.toContain('capture');
    expect(completed).toContain('detect');
    expect(completed).toContain('report');
  });

  it('continues the event sequence rather than restarting it', async () => {
    // `seq` is the SSE event id. A resumed scan that restarted at 0 would tell a
    // reconnecting client it had already seen events it never received.
    const checkpointer = createMemoryCheckpointer();
    const failed = await drain({ driver: countingDriver(true), checkpointer }, input());
    const lastSeq = failed.events.at(-1)?.seq ?? -1;

    const resumed = await drain(
      { driver: countingDriver(), checkpointer },
      input({ resume: true, startSeq: lastSeq + 1 }),
    );

    expect(resumed.events[0]?.seq).toBe(lastSeq + 1);
    const seqs = [...failed.events, ...resumed.events].map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index));
  });

  it('refuses to resume without a checkpointer instead of silently starting over', async () => {
    const result = await drain({ driver: countingDriver() }, input({ resume: true }));
    expect(result.error?.message).toContain('nothing to resume from');
  });

  it('leaves an uncheckpointed scan behaving exactly as before', async () => {
    const driver = countingDriver();
    const result = await drain({ driver }, input());
    expect(result.error).toBeUndefined();
    expect(driver.captures).toBe(1);
    expect(result.events[0]?.seq).toBe(0);
  });
});
