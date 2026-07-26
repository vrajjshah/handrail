import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ReportSchema, coverageHeadline, type Report } from '@handrail/schemas';

import { buildScoreSummary, type ScoreSummary } from './rollup.js';
import type { BuildReportInput } from './types.js';

/**
 * Assemble the canonical `report.json`.
 *
 * Everything else Handrail emits — `report.html`, SARIF, the PR summary, the
 * human-review checklist, the OpenACR draft — is rendered from this one object,
 * so every surface tells the same story and none of them can quietly compute a
 * friendlier number of its own.
 */
export function buildReport(input: BuildReportInput): Report {
  const summary = buildScoreSummary(input);
  return buildReportFromScore(input, summary);
}

/** The same assembly, when the scoring pass has already run (the graph's score node). */
export function buildReportFromScore(input: BuildReportInput, summary: ScoreSummary): Report {
  const generatedAt = input.generatedAt ?? new Date();
  return ReportSchema.parse({
    reportVersion: 1,
    generatedAt: generatedAt.toISOString(),
    tool: { name: 'handrail', version: input.toolVersion },
    scan: input.scan,
    findings: input.findings,
    scRollups: summary.scRollups,
    coverage: summary.coverage,
    trendScore: summary.trendScore,
  });
}

/**
 * The one sentence that leads the report, plus the degradation note when there
 * is one. Trust invariant 1 is a *reporting* obligation, not only a runtime one:
 * a scan that could not reach its model says so in the headline, not in a
 * footnote nobody reads.
 */
export function reportHeadline(report: Report): string {
  const headline = coverageHeadline(report.coverage);
  if (report.scan.degradations.length === 0) return headline;
  return `${headline} This scan was degraded — ${String(report.scan.degradations.length)} limitation(s) are listed in the report.`;
}

/** Writes `report.json`, creating the directory if it does not exist. */
export async function writeReportJson(outputDir: string, report: Report): Promise<string> {
  const jsonPath = join(outputDir, 'report.json');
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return jsonPath;
}
