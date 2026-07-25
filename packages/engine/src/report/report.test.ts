import {
  FindingSchema,
  ReportSchema,
  ScanRecordSchema,
  findingId,
  pageStateId,
  scanId,
  type Finding,
  type FindingInput,
  type ScRollup,
  type ScanRecord,
} from '@handrail/schemas';
import { CRITERIA_COUNT, coverageMatrix } from '@handrail/wcag';
import { describe, expect, it } from 'vitest';

import { buildReport, reportHeadline } from './build-report.js';
import { renderReportHtml, escapeHtml, safeHref } from './html.js';
import { buildCoverageLedger, buildScRollups, buildScoreSummary, manualChecklist } from './rollup.js';
import type { CheckRunSummary } from './types.js';

function finding(overrides: Partial<FindingInput> = {}): Finding {
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
    page: {
      url: 'https://example.com/',
      pageStateId: pageStateId('st_1'),
      viewport: 'desktop',
    },
    verification: { method: 'none', status: 'unverified' },
    description: 'Image has no text alternative.',
    ...overrides,
  } satisfies FindingInput);
}

function record(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return ScanRecordSchema.parse({
    id: scanId('scan_1'),
    target: { kind: 'url', url: 'https://example.com/', viewports: [{ label: 'desktop', width: 1440, height: 900 }] },
    options: { mode: 'deterministic' },
    status: 'completed',
    phase: 'report',
    createdAt: '2026-07-25T10:00:00.000Z',
    startedAt: '2026-07-25T10:00:00.000Z',
    finishedAt: '2026-07-25T10:00:30.000Z',
    ...overrides,
  });
}

function rollupFor(rollups: readonly ScRollup[], sc: string): ScRollup {
  const found = rollups.find((rollup) => String(rollup.sc) === sc);
  if (found === undefined) throw new Error(`no rollup for ${sc}`);
  return found;
}

/** `resp.reflow-320` is a `decides`-class check for 1.4.10 — the pass path. */
const reflowRun: CheckRunSummary = {
  checkId: 'resp.reflow-320',
  sc: ['1.4.10'],
  candidatesChecked: 12,
};

describe('the per-SC rollup', () => {
  it('lists every criterion in the target level, including the untested ones', () => {
    const rollups = buildScRollups({ findings: [] });
    expect(rollups).toHaveLength(CRITERIA_COUNT.total);
    expect(rollups).toHaveLength(55);
    // Nothing ran, so nothing may claim any other outcome.
    expect(rollups.every((rollup) => rollup.status === 'not-tested')).toBe(true);
  });

  it('scopes to Level A when that is the target', () => {
    const rollups = buildScRollups({ findings: [], level: 'A' });
    expect(rollups).toHaveLength(CRITERIA_COUNT.A);
    expect(rollups.every((rollup) => rollup.level === 'A')).toBe(true);
  });

  it('fails a criterion a violation touches, and names the impact', () => {
    const rollups = buildScRollups({ findings: [finding()] });
    const rollup = rollupFor(rollups, '1.1.1');
    expect(rollup.status).toBe('fail');
    expect(rollup.findingIds).toEqual(['find_1']);
    expect(rollup.checksRun).toContain('axe.image-alt');
    expect(rollup.rationale).toContain('1 measured violation');
  });

  it('fails on a likely finding too — an AI claim a verifier confirmed is still a failure', () => {
    const rollups = buildScRollups({
      findings: [finding({ tier: 'likely', source: 'ai-text', checkId: 'ai.link-purpose' })],
    });
    expect(rollupFor(rollups, '1.1.1').status).toBe('fail');
  });

  it('keeps a needs-review finding at needs-review rather than rounding it up', () => {
    const rollups = buildScRollups({ findings: [finding({ tier: 'needs-review' })] });
    expect(rollupFor(rollups, '1.1.1').status).toBe('needs-review');
  });

  it('passes a criterion only on positive evidence from a decides-class check', () => {
    const rollups = buildScRollups({ findings: [], checkRuns: [reflowRun] });
    const rollup = rollupFor(rollups, '1.4.10');
    expect(rollup.status).toBe('pass');
    expect(rollup.rationale).toContain('12 candidate(s)');
  });

  it('refuses a pass when the check examined nothing — silence over nothing is not evidence', () => {
    const rollups = buildScRollups({
      findings: [],
      checkRuns: [{ ...reflowRun, candidatesChecked: 0 }],
    });
    expect(rollupFor(rollups, '1.4.10').status).toBe('not-tested');
  });

  it('refuses a pass from a failure-detector, however clean it ran', () => {
    // axe.image-alt covers 1.1.1 as `detects-failures`: it can find missing alt
    // text but cannot certify that the alt text present is a text alternative.
    const entry = coverageMatrix('AA').find((e) => e.sc === '1.1.1');
    expect(entry?.canAutoPass).toBe(false);

    const rollups = buildScRollups({
      findings: [],
      checkRuns: [{ checkId: 'axe.image-alt', sc: ['1.1.1'], candidatesChecked: 9 }],
    });
    const rollup = rollupFor(rollups, '1.1.1');
    expect(rollup.status).toBe('not-tested');
    expect(rollup.rationale).toContain("silence is not a pass");
    // …but the fact that it ran is still recorded, so the reader can see it.
    expect(rollup.checksRun).toContain('axe.image-alt');
  });

  it('lets a failure outrank pass evidence from the same check on another state', () => {
    const rollups = buildScRollups({
      findings: [
        finding({
          id: findingId('find_reflow'),
          checkId: 'resp.reflow-320',
          source: 'heuristic:resp.reflow-320',
          sc: ['1.4.10'],
          scPrimary: '1.4.10',
          evidence: [
            { kind: 'pixels', metric: 'target-size-px', measured: 400, threshold: 320, comparator: 'lte' },
          ],
        }),
      ],
      checkRuns: [reflowRun],
    });
    expect(rollupFor(rollups, '1.4.10').status).toBe('fail');
  });

  it('records an AI check as having run without ever letting it justify a pass', () => {
    const rollups = buildScRollups({ findings: [], aiChecksRun: ['ai.link-purpose'] });
    const rollup = rollupFor(rollups, '2.4.4');
    expect(rollup.checksRun).toContain('ai.link-purpose');
    expect(rollup.status).toBe('not-tested');
  });

  it('marks a criterion not-applicable only when a detector says so', () => {
    const rollups = buildScRollups({
      findings: [],
      signals: {
        hasImages: false,
        hasPrerecordedAudio: false,
        hasPrerecordedVideo: false,
        hasLiveMedia: false,
        hasAudioAutoplay: false,
        hasForms: false,
        hasLinks: false,
        hasHeadings: false,
        hasTables: false,
        hasFramesOrIframes: false,
        hasTimeLimits: false,
        hasMovingContent: false,
        hasFlashingContent: false,
        hasPointerGestures: false,
        hasDragInteractions: false,
        hasMotionActuation: false,
        hasKeyboardShortcuts: false,
        hasHoverOrFocusContent: false,
        hasAuthentication: false,
        hasMultiStepProcess: false,
        hasLegalOrFinancialCommitment: false,
        hasForeignLanguagePassages: false,
        hasHelpMechanism: false,
        pagesInScan: 1,
      },
    });
    // Site-level criteria are the only genuinely certain absences on a one-page scan.
    expect(rollupFor(rollups, '3.2.3').status).toBe('not-applicable');
    // Absence of video is a claim about the whole site, so it stays untested.
    expect(rollupFor(rollups, '1.2.2').status).toBe('not-tested');
  });
});

describe('the coverage ledger', () => {
  it('accounts for every criterion exactly once', () => {
    const rollups = buildScRollups({ findings: [finding()], checkRuns: [reflowRun] });
    const ledger = buildCoverageLedger(rollups);

    expect(ledger.criteriaTotal).toBe(55);
    expect(
      ledger.passVerified + ledger.failed + ledger.needsReview + ledger.notApplicable + ledger.notTested,
    ).toBe(55);
    expect(ledger.evaluated).toBe(55 - ledger.notTested);
    expect(ledger.failed).toBe(1);
    expect(ledger.passVerified).toBe(1);
  });

  it('puts every unresolved criterion on the human checklist', () => {
    const rollups = buildScRollups({ findings: [finding({ tier: 'needs-review' })] });
    const ledger = buildCoverageLedger(rollups);
    expect(ledger.manualRequired).toContain('1.1.1');
    expect(ledger.manualRequired).toHaveLength(ledger.notTested + ledger.needsReview);
    expect(manualChecklist(rollups)[0]?.procedure.length).toBeGreaterThan(0);
  });
});

describe('buildReport', () => {
  it('produces a schema-valid report', () => {
    const report = buildReport({
      scan: record(),
      findings: [finding()],
      checkRuns: [reflowRun],
      toolVersion: '0.1.0',
      generatedAt: new Date('2026-07-25T10:00:31.000Z'),
    });
    expect(() => ReportSchema.parse(report)).not.toThrow();
    expect(report.reportVersion).toBe(1);
    expect(report.scRollups).toHaveLength(55);
  });

  it('leads with an honest headline and never a score out of 100', () => {
    const report = buildReport({ scan: record(), findings: [], toolVersion: '0.1.0' });
    const headline = reportHeadline(report);
    expect(headline).toMatch(/^Automatically evaluated \d+ of 55 A\/AA criteria/);
    expect(headline).not.toMatch(/out of 100|score/i);
  });

  it('says so in the headline when the scan was degraded', () => {
    const report = buildReport({
      scan: record({
        degradations: [
          {
            reason: 'model-unavailable',
            detail: 'the text judge could not reach its provider',
            phase: 'judge-text',
            at: '2026-07-25T10:00:10.000Z',
          },
        ],
      }),
      findings: [],
      toolVersion: '0.1.0',
    });
    expect(reportHeadline(report)).toContain('degraded');
  });

  it('carries the trend score with its disclaimer attached', () => {
    const summary = buildScoreSummary({ findings: [finding()] });
    expect(summary.trendScore.value).toBeLessThan(100);
    expect(summary.trendScore.disclaimer).toContain('Not an accessibility score');
  });
});

describe('escaping — page content is untrusted input', () => {
  it('escapes ampersand first, so nothing is double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml(`" '`)).toBe('&quot; &#39;');
  });

  it('rejects any href scheme that is not http(s)', () => {
    expect(safeHref('https://example.com/a?b=1')).toContain('https://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('not a url')).toBeUndefined();
  });

  it('never emits an unescaped angle bracket from page-derived strings', () => {
    const hostile = '</script><img src=x onerror="alert(1)">';
    const report = buildReport({
      scan: record(),
      findings: [
        finding({
          description: hostile,
          element: { selector: `[data-x="${hostile}"]`, accessibleName: hostile, role: hostile },
          evidence: [
            { kind: 'dom', excerpt: hostile },
            { kind: 'tool', tool: 'axe-core', ruleId: hostile, output: hostile },
          ],
        }),
      ],
      toolVersion: '0.1.0',
    });

    const html = renderReportHtml(report);
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    // The only `</script>` in the document is the one closing our own filter block.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('does not turn a hostile page URL into a live link', () => {
    const report = buildReport({
      scan: record({
        target: {
          kind: 'url',
          url: 'https://example.com/',
          viewports: [{ label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 }],
          crawl: {
            maxPages: 5,
            maxDepth: 3,
            sameOriginOnly: true,
            useSitemap: true,
            templateDedupe: { enabled: true, perTemplate: 2 },
            include: [],
            exclude: [],
          },
          budget: { maxUsd: 1.5, maxDurationMs: 600_000, maxModelTokens: 2_000_000 },
        },
      }),
      findings: [],
      toolVersion: '0.1.0',
    });
    expect(renderReportHtml(report)).toContain('<a href="https://example.com/">');
  });
});

describe('report.html', () => {
  const report = buildReport({
    scan: record(),
    findings: [finding()],
    checkRuns: [reflowRun],
    toolVersion: '0.1.0',
    generatedAt: new Date('2026-07-25T10:00:31.000Z'),
  });

  it('is one self-contained file with no external request', () => {
    const html = renderReportHtml(report);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/https?:\/\/(?!example\.com)/);
  });

  it('carries the landmarks and heading outline its own scan will look for', () => {
    const html = renderReportHtml(report);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<nav aria-label="Report sections">');
    expect(html).toMatch(/<footer/);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('class="skip-link"');
    expect(html).toContain(':focus-visible');
  });

  it('states the coverage headline and lists every criterion, untested included', () => {
    const html = renderReportHtml(report);
    expect(html).toContain('Automatically evaluated');
    for (const rollup of report.scRollups) {
      expect(html).toContain(String(rollup.sc));
    }
    expect(html).toContain('Not tested');
  });

  it('labels each finding with its source and tier in words, never colour alone', () => {
    const html = renderReportHtml(report);
    expect(html).toContain('Violation — measured');
    expect(html).toContain('Deterministic');
    expect(html).toContain('data-tier="violation"');
    expect(html).toContain('data-source="deterministic"');
  });

  it('marks an AI finding as AI', () => {
    const aiReport = buildReport({
      scan: record(),
      findings: [
        finding({
          source: 'ai-text',
          tier: 'likely',
          checkId: 'ai.link-purpose',
          verification: { method: 'model-verifier', status: 'confirmed' },
        }),
      ],
      toolVersion: '0.1.0',
    });
    const html = renderReportHtml(aiReport);
    expect(html).toContain('data-source="ai"');
    expect(html).toContain('AI judgment');
    expect(html).toContain('Likely — AI + verifier');
  });

  it('reports the cost footer, including a $0 deterministic scan', () => {
    expect(renderReportHtml(report)).toContain('no model was called at all');
  });

  it('positions a bbox overlay from the image percentages it was given', () => {
    const shotReport = buildReport({
      scan: record(),
      findings: [
        finding({
          evidence: [{ kind: 'screenshot', artifactId: 'art_1', caption: 'the unlabelled image' }],
        }),
      ],
      toolVersion: '0.1.0',
    });
    const html = renderReportHtml(shotReport, {
      images: new Map([
        [
          'find_1:0',
          {
            dataUri: 'data:image/png;base64,AAAA',
            width: 200,
            height: 100,
            highlight: { left: 10, top: 20, width: 30, height: 40 },
          },
        ],
      ]),
    });
    expect(html).toContain('class="bbox"');
    expect(html).toContain('left:10.000%');
    expect(html).toContain('height:40.000%');
  });

  it('says a screenshot exists rather than silently dropping it when it is not embedded', () => {
    const shotReport = buildReport({
      scan: record(),
      findings: [
        finding({
          evidence: [{ kind: 'screenshot', artifactId: 'art_1', caption: 'the button' }],
        }),
      ],
      toolVersion: '0.1.0',
    });
    expect(renderReportHtml(shotReport)).toContain('is not embedded in this file');
  });

  it('shows the degradation banner when the scan could not do everything', () => {
    const degraded = buildReport({
      scan: record({
        degradations: [
          {
            reason: 'model-unavailable',
            detail: 'provider returned 429',
            phase: 'judge-text',
            at: '2026-07-25T10:00:10.000Z',
          },
        ],
      }),
      findings: [],
      toolVersion: '0.1.0',
    });
    const html = renderReportHtml(degraded);
    expect(html).toContain('This scan was degraded');
    expect(html).toContain('provider returned 429');
  });
});
