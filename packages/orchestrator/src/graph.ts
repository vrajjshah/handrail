import {
  allFindings,
  buildHallucinationLedger,
  runTextJudgment,
  writeHallucinationLedger,
  type HallucinationEntry,
  type StateCapture,
} from '@handrail/engine';
import { ModelError, type CostLedger, type ModelClient } from '@handrail/model';
import {
  type Degradation,
  type Finding,
  type ScanEvent,
  type ScanPhase,
  type ScanRecord,
  ScanRecordSchema,
  type ScanId,
} from '@handrail/schemas';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { ScanDriver } from './driver.js';
import { ScanEventEmitter } from './events.js';
import { ScanStateSchema, type ScanState } from './state.js';

export interface ScanGraphDeps {
  driver: ScanDriver;
  /** Absent in `deterministic` mode: there is nothing to call. */
  model?: {
    ledger: CostLedger;
    client: ModelClient;
    /** Better a different client than the judge's — independence is the point. */
    verifierClient?: ModelClient;
  };
  /** Where `hallucination-ledger.json` is written. Omit to skip writing it. */
  outputDir?: string;
}

/** The eight phases this graph runs, in order. Named for `ScanPhaseSchema`. */
export const SCAN_NODES = [
  'crawl',
  'capture',
  'detect',
  'judge-text',
  'verdict',
  'site',
  'score',
  'report',
] as const satisfies readonly ScanPhase[];

/**
 * The slice of the compiled graph this package actually drives.
 *
 * LangGraph's own compiled type cannot be named portably from outside its
 * package (TS2883), and every consumer here needs exactly one method. Narrowing
 * to it keeps the seam small and the declaration emit clean.
 */
export interface CompiledScanGraph {
  stream(
    input: Pick<ScanState, 'target' | 'options'>,
    options: { streamMode: readonly ('custom' | 'values')[] },
  ): Promise<AsyncIterable<[string, unknown]>>;
}

/** One capture per URL — the state the text judge reads for that page. */
function firstCapturePerUrl(captures: readonly StateCapture[]): StateCapture[] {
  const byUrl = new Map<string, StateCapture>();
  for (const capture of captures) {
    if (!byUrl.has(capture.url)) byUrl.set(capture.url, capture);
  }
  return [...byUrl.values()];
}

function degradation(reason: Degradation['reason'], detail: string, phase: ScanPhase, at: Date): Degradation {
  return { reason, detail: detail.slice(0, 2000), phase, at: at.toISOString() };
}

/**
 * Build the scan graph.
 *
 * Compiled per run because the {@link ScanEventEmitter} owns `seq` and `seq` is
 * per-scan. Every node body is a call into `@handrail/engine`: the graph decides
 * *when* things happen and what the event stream looks like, and knows nothing
 * about how a page is captured or a claim is grounded. That is the layering rule
 * this package exists to hold — `@langchain/*` appears here and in no other
 * package, so a surface can drive a scan without importing an orchestration
 * library.
 */
export function createScanGraph(
  deps: ScanGraphDeps,
  emitter: ScanEventEmitter,
): CompiledScanGraph {
  /** Bind the node's custom-stream writer, run the body, and time the phase. */
  function phase(
    name: ScanPhase,
    body: (state: ScanState) => Promise<Partial<ScanState>>,
  ): (state: ScanState, config: LangGraphRunnableConfig) => Promise<Partial<ScanState>> {
    return async (state, config) => {
      emitter.useSink(config.writer);
      const startedAt = Date.now();
      emitter.emit({ type: 'phase.started', phase: name });
      try {
        const update = await body(state);
        emitter.emit({
          type: 'phase.completed',
          phase: name,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
        return update;
      } catch (error) {
        emitter.emit({
          type: 'phase.failed',
          phase: name,
          code: error instanceof ModelError ? error.code : 'phase-error',
          message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        });
        throw error;
      } finally {
        emitter.useSink(undefined);
      }
    };
  }

  const crawl = phase('crawl', (state) => {
    // Phase 1 scans the target URL itself; BFS crawling is #46.
    const urls = state.target.kind === 'url' ? [state.target.url] : [];
    emitter.emit({
      type: 'log',
      level: 'info',
      message: `resolved ${String(urls.length)} url(s) to scan`,
      phase: 'crawl',
    });
    return Promise.resolve({ urls });
  });

  const capture = phase('capture', async (state) => {
    const captures: StateCapture[] = [];
    for (const url of state.urls) {
      for (const viewport of state.target.viewports) {
        const captured = await deps.driver.capture({ url, viewport });
        captures.push(captured);
        if (captured.artifacts.fullPage !== null) {
          emitter.emit({
            type: 'screenshot.captured',
            artifactId: captured.artifacts.fullPage,
            pageStateId: captured.pageStateId,
            url: captured.url,
            viewport: captured.viewport.label,
          });
        }
      }
    }
    return { captures };
  });

  const detect = phase('detect', async (state) => {
    const findings: Finding[] = [];
    const degradations: Degradation[] = [];
    for (const captured of state.captures) {
      try {
        const axe = await deps.driver.axe(captured);
        const heuristics = await deps.driver.heuristics(captured);
        for (const finding of [...axe.findings, ...allFindings(heuristics)]) {
          findings.push(finding);
          emitter.emit({ type: 'finding.detected', finding });
        }
      } finally {
        // axe runs *in* the page and the keyboard walk presses real Tab keys, so
        // the page stays open until both are done with it — then always closes.
        await deps.driver.release(captured);
      }
    }
    return { findings: [...state.findings, ...findings], degradations: [...state.degradations, ...degradations] };
  });

  const judgeText = phase('judge-text', async (state) => {
    if (deps.model === undefined) {
      emitter.emit({
        type: 'log',
        level: 'info',
        message: 'deterministic mode: the text judge did not run',
        phase: 'judge-text',
      });
      return {};
    }

    const findings: Finding[] = [];
    const rejected: HallucinationEntry[] = [];
    const degradations: Degradation[] = [];
    const checksRun = new Set(state.checksRun);
    let candidatesSeen = state.candidatesSeen;

    // One judgment per URL, not per captured state: the same page judged at two
    // viewports is the same page. The engine had no business deciding that.
    for (const captured of firstCapturePerUrl(state.captures)) {
      const at = new Date();
      try {
        const judged = await runTextJudgment(
          {
            ledger: deps.model.ledger,
            client: deps.model.client,
            ...(deps.model.verifierClient === undefined
              ? {}
              : { verifierClient: deps.model.verifierClient }),
          },
          captured,
        );
        for (const finding of judged.findings) {
          findings.push(finding);
          emitter.emit({ type: 'finding.detected', finding });
        }
        rejected.push(...judged.rejected);
        candidatesSeen += judged.candidatesSeen;
        for (const check of judged.checksRun) checksRun.add(check);
        for (const entry of judged.degradations) {
          degradations.push(
            degradation(
              entry.reason === 'verifier-unavailable' ? 'model-unavailable' : 'crawl-truncated',
              entry.detail,
              'judge-text',
              at,
            ),
          );
        }
      } catch (error) {
        // Trust invariant 1: an unreachable model degrades the scan loudly. It
        // never silently downgrades to "deterministic results, as requested".
        degradations.push(
          degradation(
            'model-unavailable',
            `text judgment failed for ${captured.url}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'judge-text',
            at,
          ),
        );
      }
    }

    return {
      findings: [...state.findings, ...findings],
      rejected: [...state.rejected, ...rejected],
      degradations: [...state.degradations, ...degradations],
      checksRun: [...checksRun],
      candidatesSeen,
    };
  });

  const verdict = phase('verdict', async (state) => {
    for (const entry of state.degradations) {
      emitter.emit({ type: 'scan.degraded', degradation: entry });
    }

    if (deps.outputDir !== undefined) {
      // Telemetry, written beside the report and never part of it.
      const ledger = buildHallucinationLedger({
        scanId: emitter.scanId,
        candidatesSeen: state.candidatesSeen,
        entries: state.rejected,
      });
      await writeHallucinationLedger(deps.outputDir, ledger);
      emitter.emit({
        type: 'log',
        level: 'info',
        message: `wrote hallucination ledger with ${String(state.rejected.length)} rejected candidate(s)`,
        phase: 'verdict',
      });
    }
    return {};
  });

  const site = phase('site', (state) => {
    // Site-level checks (consistent nav 3.2.3, multiple ways 2.4.5, …) are #45.
    emitter.emit({
      type: 'log',
      level: 'info',
      message: `site-level checks are not implemented yet; ${String(state.urls.length)} url(s) seen`,
      phase: 'site',
    });
    return Promise.resolve({});
  });

  const score = phase('score', (state) => {
    emitter.emit({
      type: 'log',
      level: 'info',
      message:
        `${String(state.findings.length)} finding(s) across ` +
        `${String(state.captures.length)} state(s); ${String(state.checksRun.length)} AI check(s) ran`,
      phase: 'score',
    });
    return Promise.resolve({});
  });

  const report = phase('report', (state) => {
    emitter.emit({
      type: 'log',
      level: 'info',
      message: 'report assembled',
      phase: 'report',
    });
    return Promise.resolve({ findings: state.findings });
  });

  const compiled = new StateGraph(ScanStateSchema)
    .addNode('crawl', crawl)
    .addNode('capture', capture)
    .addNode('detect', detect)
    .addNode('judge-text', judgeText)
    .addNode('verdict', verdict)
    .addNode('site', site)
    .addNode('score', score)
    .addNode('report', report)
    .addEdge(START, 'crawl')
    .addEdge('crawl', 'capture')
    .addEdge('capture', 'detect')
    .addEdge('detect', 'judge-text')
    .addEdge('judge-text', 'verdict')
    .addEdge('verdict', 'site')
    .addEdge('site', 'score')
    .addEdge('score', 'report')
    .addEdge('report', END)
    .compile();

  // Narrowing a third-party generic whose full form is not nameable from here
  // (TS2883). The single method we drive is checked against `CompiledScanGraph`
  // at every call site.
  return compiled as unknown as CompiledScanGraph;
}

export interface RunScanInput {
  scanId: ScanId;
  target: ScanState['target'];
  options: ScanState['options'];
  /** Clock seam, so a golden-scan run is reproducible. */
  now?: () => Date;
}

export interface ScanRunResult {
  record: ScanRecord;
  events: ScanEvent[];
  findings: Finding[];
  rejected: HallucinationEntry[];
}

/**
 * Run a scan, streaming every `ScanEvent` as it happens.
 *
 * The stream is the product: the CLI renders it as progress, the server replays
 * it over SSE with `Last-Event-ID`, and the golden-scan test diffs a normalised
 * version of it. All three read the same events in the same order.
 */
export async function* streamScan(
  input: RunScanInput,
  deps: ScanGraphDeps,
): AsyncGenerator<ScanEvent, ScanRunResult> {
  const now = input.now ?? (() => new Date());
  const emitter = new ScanEventEmitter({ scanId: input.scanId, ...(input.now ? { now } : {}) });
  const graph = createScanGraph(deps, emitter);

  const createdAt = now().toISOString();
  const startedAtMs = Date.now();
  const emitted: ScanEvent[] = [];
  let final: ScanState | undefined;

  const collect = (event: ScanEvent) => {
    emitted.push(event);
  };

  try {
    // Two stream modes, one run. `custom` yields exactly what a node hands to
    // `config.writer` — which is what lets nodes speak in `ScanEvent`s rather
    // than state diffs — while `values` carries the state snapshot so the final
    // one is available without invoking the graph a second time. Running it
    // twice would double every capture, every model call and every dollar.
    const stream = await graph.stream(
      { target: input.target, options: input.options },
      { streamMode: ['custom', 'values'] },
    );
    for await (const [mode, payload] of stream) {
      if (mode === 'custom') {
        const event = payload as ScanEvent;
        collect(event);
        yield event;
      } else {
        final = payload as ScanState;
      }
    }
  } catch (error) {
    const failure = emitter.emit({
      type: 'scan.failed',
      code: error instanceof ModelError ? error.code : 'scan-error',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
    });
    collect(failure);
    yield failure;
    await deps.driver.dispose();
    throw error;
  }

  await deps.driver.dispose();

  const findings = final?.findings ?? [];
  const degradations = final?.degradations ?? [];
  const completion = emitter.emit({
    type: 'scan.completed',
    findingsTotal: findings.length,
    costUsd: deps.model?.ledger.totalCostUsd ?? 0,
    durationMs: Math.max(0, Date.now() - startedAtMs),
  });
  collect(completion);
  yield completion;

  const record = ScanRecordSchema.parse({
    id: input.scanId,
    target: input.target,
    options: input.options,
    status: 'completed',
    phase: 'report',
    counts: {
      pagesDiscovered: final?.urls.length ?? 0,
      pagesCaptured: final?.urls.length ?? 0,
      statesCaptured: final?.captures.length ?? 0,
      findingsTotal: findings.length,
      findingsViolation: findings.filter((f) => f.tier === 'violation').length,
      findingsLikely: findings.filter((f) => f.tier === 'likely').length,
      findingsNeedsReview: findings.filter((f) => f.tier === 'needs-review').length,
      candidatesRejected: final?.rejected.length ?? 0,
    },
    costUsd: deps.model?.ledger.totalCostUsd ?? 0,
    degradations,
    createdAt,
    startedAt: createdAt,
    finishedAt: now().toISOString(),
  });

  return { record, events: emitted, findings, rejected: final?.rejected ?? [] };
}

/** Collecting wrapper for callers that just want the result. */
export async function runScan(
  input: RunScanInput,
  deps: ScanGraphDeps,
): Promise<ScanRunResult> {
  const iterator = streamScan(input, deps);
  let step = await iterator.next();
  while (!step.done) step = await iterator.next();
  return step.value;
}
