import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  FileSystemArtifactStore,
  buildEvidenceImages,
  launchChromium,
  renderReportHtml,
  writeReportJson,
  type ArtifactStore,
  type Browser,
} from '@handrail/engine';
import {
  ScanOptionsSchema,
  ScanTargetSchema,
  coverageHeadline,
  scanId as toScanId,
  type Report,
  type ScanId,
  type Tier,
} from '@handrail/schemas';
import {
  checkEventStream,
  createPlaywrightDriver,
  streamScan,
  type ScanDriver,
  type ScanGraphDeps,
} from '@handrail/orchestrator';

import type { ScanArgs } from './args.js';
import { createModelSetup, type ModelSetup } from './model.js';
import { openInBrowser } from './open.js';
import { ProgressRenderer } from './render.js';
import { HANDRAIL_VERSION } from './version.js';

export interface DriverHandle {
  driver: ScanDriver;
  close: () => Promise<void>;
}

export interface ScanCommandDeps {
  /** Progress goes to stderr, so stdout stays clean for `--ndjson`. */
  write: (line: string) => void;
  writeOut: (line: string) => void;
  env?: Record<string, string | undefined>;
  color?: boolean;
  scanId?: ScanId;
  /** Test seam: replay a committed capture instead of launching Chromium. */
  createDriver?: (args: ScanArgs) => Promise<DriverHandle>;
  createModel?: (options: Parameters<typeof createModelSetup>[0]) => ModelSetup;
  openReport?: (target: string) => Promise<void>;
}

export interface ScanCommandResult {
  exitCode: number;
  report: Report;
  jsonPath: string;
  htmlPath: string | undefined;
}

const TIER_RANK: Record<Tier, number> = { 'needs-review': 0, likely: 1, violation: 2 };

async function playwrightDriver(args: ScanArgs): Promise<DriverHandle> {
  const browser: Browser = await launchChromium();
  return {
    driver: createPlaywrightDriver(browser, { navigationTimeoutMs: args.navigationTimeoutMs }),
    close: () => browser.close(),
  };
}

/**
 * `handrail scan <url>`.
 *
 * Everything here is composition. The orchestrator runs the scan and emits the
 * events; the engine builds the report and renders it; this function decides
 * where the files go, what the exit code means, and how the stream looks on a
 * terminal. It re-derives nothing — the totals on screen are the events'
 * totals, and the summary is the report's own headline.
 */
export async function runScanCommand(
  args: ScanArgs,
  deps: ScanCommandDeps,
): Promise<ScanCommandResult> {
  const env = deps.env ?? process.env;
  const scanId = deps.scanId ?? toScanId(`scan_${randomUUID()}`);
  const outDir = path.resolve(args.outDir);

  const target = ScanTargetSchema.parse({
    kind: 'url',
    url: args.url,
    viewports: args.viewports,
    // A `--budget-usd` above the target default would otherwise be silently
    // clamped by `effectiveBudgetUsd`, which takes the *minimum* of the two.
    ...(args.budgetUsd === undefined ? {} : { budget: { maxUsd: args.budgetUsd } }),
  });
  const options = ScanOptionsSchema.parse({
    mode: args.mode,
    wcagTarget: { level: args.level },
    ...(args.budgetUsd === undefined ? {} : { budgetUsd: args.budgetUsd }),
  });

  const createModel = deps.createModel ?? createModelSetup;
  const setup = createModel({
    mode: args.mode,
    scanId,
    budgetUsd: args.budgetUsd,
    env,
  });

  const renderer = new ProgressRenderer({
    write: deps.write,
    ...(deps.color === undefined ? {} : { color: deps.color }),
    quiet: args.quiet,
  });

  deps.write(`handrail ${HANDRAIL_VERSION}  scanning ${args.url}`);
  for (const note of setup.notes) deps.write(`  ${note}`);
  deps.write('');

  await mkdir(outDir, { recursive: true });
  const artifacts: ArtifactStore | undefined = args.screenshots
    ? new FileSystemArtifactStore(path.join(outDir, 'artifacts'))
    : undefined;

  const handle = await (deps.createDriver ?? playwrightDriver)(args);
  const graphDeps: ScanGraphDeps = {
    driver: handle.driver,
    outputDir: outDir,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(setup.model === undefined ? {} : { model: setup.model }),
  };

  let report: Report;
  try {
    const stream = streamScan(
      { scanId, target, options, toolVersion: HANDRAIL_VERSION },
      graphDeps,
    );

    let step = await stream.next();
    while (!step.done) {
      renderer.event(step.value);
      if (args.ndjson) deps.writeOut(JSON.stringify(step.value));
      step = await stream.next();
    }
    const result = step.value;

    // The orchestrator exports this so every surface asserts well-orderedness
    // the same way rather than each re-deriving what "in order" means.
    const problems = checkEventStream(result.events);
    for (const problem of problems) deps.write(`  event stream problem: ${problem}`);

    report = result.report;
  } finally {
    await handle.close();
  }

  const jsonPath = await writeReportJson(outDir, report);
  let htmlPath: string | undefined;

  if (args.report === 'html') {
    const images =
      artifacts === undefined
        ? new Map()
        : await buildEvidenceImages(report, { store: artifacts });
    const html = renderReportHtml(report, {
      images,
      invocations: setup.model?.ledger.invocations ?? [],
      candidatesRejected: report.scan.counts.candidatesRejected,
    });
    htmlPath = path.join(outDir, 'report.html');
    await writeFile(htmlPath, html, 'utf8');
  }

  writeSummary(report, { ...deps, jsonPath, htmlPath });

  if (args.open && htmlPath !== undefined) {
    try {
      await (deps.openReport ?? openInBrowser)(htmlPath);
    } catch (error) {
      deps.write(`  could not open the report: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { exitCode: exitCodeFor(report, args.failOn), report, jsonPath, htmlPath };
}

/**
 * Exit 2 when a finding reaches the threshold, 0 otherwise.
 *
 * Deliberately not 1: 1 is "handrail itself failed", and a CI job needs to tell
 * "your site has violations" apart from "the scanner crashed".
 */
export function exitCodeFor(report: Report, failOn: Tier | undefined): number {
  if (failOn === undefined) return 0;
  const threshold = TIER_RANK[failOn];
  return report.findings.some((finding) => TIER_RANK[finding.tier] >= threshold) ? 2 : 0;
}

function writeSummary(
  report: Report,
  deps: { write: (line: string) => void; jsonPath: string; htmlPath: string | undefined },
): void {
  const { coverage } = report;
  deps.write('');
  deps.write(coverageHeadline(coverage));
  deps.write(
    `  ${String(coverage.failed)} fail  ${String(coverage.needsReview)} need review  ` +
      `${String(coverage.passVerified)} pass-verified  ${String(coverage.notApplicable)} n/a  ` +
      `${String(coverage.notTested)} not tested`,
  );
  if (report.scan.degradations.length > 0) {
    deps.write(`  degraded: ${report.scan.degradations.map((d) => d.reason).join(', ')}`);
  }
  deps.write(`  cost: $${report.scan.costUsd.toFixed(4)}`);
  deps.write('');
  deps.write(`  report.json  ${deps.jsonPath}`);
  if (deps.htmlPath !== undefined) deps.write(`  report.html  ${deps.htmlPath}`);
}
