/**
 * Record the seeded-demo recall baseline.
 *
 *   pnpm --filter @handrail/cli recall:baseline            # check
 *   pnpm --filter @handrail/cli recall:baseline --update   # re-record
 *
 * Phase 1's acceptance asks for "seeded-demo recall vs ground truth recorded as
 * a baseline". This is that number, and it is deliberately measured end to end:
 * the deterministic layers run against a real browser, and the AI layer replays
 * the committed cassettes, so the figure reflects what Handrail actually finds
 * rather than what its unit tests script it to find.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { StateCaptureSchema, runTextJudgment } from '@handrail/engine';
import { CostLedger, FileCassetteStore, createBedrockClient, withCassettes } from '@handrail/model';
import { runScan } from '@handrail/orchestrator';
import { createPlaywrightDriver } from '@handrail/orchestrator';
import {
  ScanOptionsSchema,
  ScanTargetSchema,
  scanId,
  type Finding,
} from '@handrail/schemas';
import { chromium } from 'playwright';

import { measureRecall, serializeBaseline, type GroundTruthDefect } from '../recall.js';
import { REPO_ROOT, serveFixture } from './fixture-server.js';

const RECALL_PORT = 5180;
const BASELINE_FILE = join(REPO_ROOT, 'fixtures', 'golden', 'seeded-demo.recall.json');
const GROUND_TRUTH = join(REPO_ROOT, 'fixtures', 'apps', 'seeded-demo', 'ground-truth.json');
const CAPTURE = join(
  REPO_ROOT,
  'packages',
  'engine',
  'src',
  'judge',
  '__fixtures__',
  'seeded-demo-desktop.capture.json',
);
const ANCHORS = join(
  REPO_ROOT,
  'packages',
  'engine',
  'src',
  'judge',
  '__fixtures__',
  'seeded-demo-anchors.json',
);
const CASSETTES = join(REPO_ROOT, 'packages', 'model', 'cassettes');

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** axe + the heuristics, against a real browser on the real fixture. */
async function deterministicFindings(): Promise<Finding[]> {
  const fixture = await serveFixture(RECALL_PORT);
  const browser = await chromium.launch();
  try {
    const result = await runScan(
      {
        scanId: scanId('scan_recall'),
        target: ScanTargetSchema.parse({
          kind: 'url',
          url: fixture.origin,
          viewports: [{ label: 'desktop', width: 1280, height: 800 }],
        }),
        options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
      },
      { driver: createPlaywrightDriver(browser) },
    );
    return result.findings;
  } finally {
    await browser.close();
    await fixture.close();
  }
}

/**
 * The text judge, replayed from the committed corpus.
 *
 * Replayed rather than re-run so the baseline is reproducible and free — and it
 * is measured over the committed capture of this same page, so the xpaths line
 * up with the anchors the deterministic findings are matched by.
 */
async function aiFindings(): Promise<Finding[]> {
  const capture = StateCaptureSchema.parse(await readJson(CAPTURE));
  const store = new FileCassetteStore(CASSETTES);
  const client = createBedrockClient({
    wrapTransport: (inner) => withCassettes(inner, { mode: 'replay', store }),
  });
  const ledger = new CostLedger({ scanId: scanId('scan_recall_ai') });
  const judged = await runTextJudgment({ ledger, client, verifierClient: client }, capture);
  return judged.findings;
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');

  const groundTruth = await readJson<{
    fixture: string;
    expected: GroundTruthDefect[];
    traps: { id: string }[];
  }>(GROUND_TRUTH);
  const anchors = await readJson<Record<string, string>>(ANCHORS);

  const findings = [...(await deterministicFindings()), ...(await aiFindings())];
  const baseline = measureRecall({
    fixture: groundTruth.fixture,
    defects: groundTruth.expected,
    traps: groundTruth.traps,
    anchors,
    findings,
  });
  const actual = serializeBaseline(baseline);

  const { overall, byDetectabilityClass, trapsFlagged } = baseline;
  console.log(
    `recall ${String(overall.found)}/${String(overall.planted)} (${String(Math.round(overall.recall * 100))}%)`,
  );
  for (const row of byDetectabilityClass) {
    console.log(
      `  ${row.detectableBy.padEnd(14)} ${String(row.found)}/${String(row.planted)}`,
    );
  }
  console.log(
    trapsFlagged.length === 0
      ? '  traps flagged: none'
      : `  traps flagged: ${trapsFlagged.join(', ')}  <-- false positives`,
  );

  if (update) {
    await writeFile(BASELINE_FILE, actual, 'utf8');
    console.log(`\nupdated ${BASELINE_FILE}`);
    return;
  }

  let expected: string;
  try {
    expected = await readFile(BASELINE_FILE, 'utf8');
  } catch {
    console.error(`\nno baseline committed. Run with --update.`);
    process.exitCode = 1;
    return;
  }

  if (expected === actual) {
    console.log('\nrecall matches the committed baseline');
    return;
  }

  // A *drop* is a regression; a *rise* is progress that still has to be recorded
  // deliberately, so both fail until someone re-records and reviews the diff.
  console.error('\nRecall has changed from the committed baseline.');
  console.error('Re-record with: pnpm --filter @handrail/cli recall:baseline --update');
  process.exitCode = 1;
}

await main();
