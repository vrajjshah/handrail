import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  StateCaptureSchema,
  type AxeDetectionResult,
  type HeuristicResult,
  type StateCapture,
} from '@handrail/engine';
import { CostLedger, createDeterministicClient } from '@handrail/model';
import {
  FindingSchema,
  ScanEventSchema,
  ScanOptionsSchema,
  ScanTargetSchema,
  isTerminalEvent,
  scanId,
  type ScanEvent,
} from '@handrail/schemas';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkEventStream } from './events.js';
import { SCAN_NODES, runScan, type ScanGraphDeps } from './graph.js';
import type { CaptureRequest, ScanDriver } from './driver.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_FIXTURE = path.resolve(
  HERE,
  '../../engine/src/judge/__fixtures__/seeded-demo-desktop.capture.json',
);

let capture: StateCapture;

beforeAll(async () => {
  // The real committed capture of the seeded-demo, the same one #10's acceptance
  // suite runs against. Replaying it is what lets the graph's acceptance run
  // browser-free on three operating systems.
  capture = StateCaptureSchema.parse(JSON.parse(await readFile(CAPTURE_FIXTURE, 'utf8')));
});

const axeFinding = () =>
  FindingSchema.parse({
    id: 'find_axe_1',
    checkId: 'axe.image-alt',
    source: 'axe',
    sc: ['1.1.1'],
    scPrimary: '1.1.1',
    tier: 'violation',
    severity: 'critical',
    confidence: 1,
    evidence: [{ kind: 'tool', tool: 'axe-core', ruleId: 'image-alt', output: 'no alt' }],
    page: { url: capture.url, pageStateId: capture.pageStateId, viewport: 'desktop' },
    verification: { method: 'deterministic-recheck', status: 'confirmed' },
    description: 'Image has no text alternative.',
  });

/** Replays the committed capture. A drop-in for the Playwright driver. */
function replayDriver(): ScanDriver & { released: string[]; disposed: boolean } {
  const released: string[] = [];
  return {
    released,
    disposed: false,
    capture(_request: CaptureRequest): Promise<StateCapture> {
      return Promise.resolve(capture);
    },
    axe(): Promise<AxeDetectionResult> {
      return Promise.resolve({
        findings: [axeFinding()],
        passes: [],
        degradations: [],
        axeVersion: '4.12.1',
      });
    },
    heuristics(): Promise<HeuristicResult> {
      return Promise.resolve({ outcomes: [], degradations: [] });
    },
    release(released_: StateCapture): Promise<void> {
      released.push(String(released_.pageStateId));
      return Promise.resolve();
    },
    dispose(): Promise<void> {
      this.disposed = true;
      return Promise.resolve();
    },
  };
}

/**
 * One viewport on purpose. The default target carries three (desktop, mobile,
 * reflow-320), and the graph captures each — correct, but it makes every count
 * in these assertions a multiple of the matrix size rather than a statement
 * about the graph. The matrix itself is exercised separately below.
 */
function scanInput(viewportCount = 1) {
  const viewports = [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'mobile', width: 390, height: 844 },
  ].slice(0, viewportCount);

  return {
    scanId: scanId('scan_graph_test'),
    target: ScanTargetSchema.parse({ kind: 'url', url: capture.url, viewports }),
    options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
  };
}

describe('the scan graph', () => {
  it('runs all eight phases in order and emits a well-ordered stream', async () => {
    const driver = replayDriver();
    const result = await runScan(scanInput(), { driver });

    const started = result.events
      .filter((e): e is Extract<ScanEvent, { type: 'phase.started' }> => e.type === 'phase.started')
      .map((e) => e.phase);
    expect(started).toEqual([...SCAN_NODES]);

    const completed = result.events
      .filter(
        (e): e is Extract<ScanEvent, { type: 'phase.completed' }> => e.type === 'phase.completed',
      )
      .map((e) => e.phase);
    expect(completed).toEqual([...SCAN_NODES]);

    expect(checkEventStream(result.events)).toEqual([]);
  });

  it('emits only events that validate against ScanEventSchema', async () => {
    const result = await runScan(scanInput(), { driver: replayDriver() });
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(() => ScanEventSchema.parse(event)).not.toThrow();
    }
  });

  it('ends with exactly one terminal event, last', async () => {
    const result = await runScan(scanInput(), { driver: replayDriver() });
    const terminals = result.events.filter(isTerminalEvent);
    expect(terminals).toHaveLength(1);
    expect(result.events.at(-1)?.type).toBe('scan.completed');
  });

  it('streams deterministic findings as they are detected', async () => {
    const result = await runScan(scanInput(), { driver: replayDriver() });
    const detected = result.events.filter((e) => e.type === 'finding.detected');
    expect(detected).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(result.record.counts.findingsViolation).toBe(1);
  });

  it('releases every captured page and disposes the driver', async () => {
    const driver = replayDriver();
    await runScan(scanInput(), { driver });
    expect(driver.released).toEqual([String(capture.pageStateId)]);
    expect(driver.disposed).toBe(true);
  });

  it('skips the text judge in deterministic mode and says so', async () => {
    const result = await runScan(scanInput(), { driver: replayDriver() });
    const log = result.events.find(
      (e) => e.type === 'log' && e.message.includes('the text judge did not run'),
    );
    expect(log).toBeDefined();
    expect(result.record.costUsd).toBe(0);
  });

  it('produces a schema-valid ScanRecord', async () => {
    const result = await runScan(scanInput(), { driver: replayDriver() });
    expect(result.record.status).toBe('completed');
    expect(result.record.counts.statesCaptured).toBe(1);
    expect(result.record.degradations).toEqual([]);
  });

  it('captures one state per viewport in the matrix', async () => {
    const driver = replayDriver();
    const result = await runScan(scanInput(2), { driver });
    expect(result.record.counts.statesCaptured).toBe(2);
    // Still one page discovered — the matrix multiplies states, not pages.
    expect(result.record.counts.pagesCaptured).toBe(1);
    expect(driver.released).toHaveLength(2);
  });
});

describe('trust invariant 1 — an unreachable model degrades the scan loudly', () => {
  it('records a degradation and emits scan.degraded rather than silently going deterministic', async () => {
    const failing = createDeterministicClient({
      responders: [() => ({ kind: 'error', code: 'overloaded', message: 'provider down' })],
    });
    const deps: ScanGraphDeps = {
      driver: replayDriver(),
      model: { ledger: new CostLedger({ scanId: scanId('scan_graph_test') }), client: failing },
    };

    const result = await runScan(
      { ...scanInput(), options: ScanOptionsSchema.parse({ mode: 'hybrid' }) },
      deps,
    );

    const degraded = result.events.filter((e) => e.type === 'scan.degraded');
    expect(degraded.length).toBeGreaterThan(0);
    expect(result.record.degradations[0]?.reason).toBe('model-unavailable');
    // The scan still completes and reports what it could do — it does not pretend.
    expect(result.record.status).toBe('completed');
    expect(checkEventStream(result.events)).toEqual([]);
  });
});
