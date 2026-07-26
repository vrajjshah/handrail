import {
  FindingSchema,
  ReportSchema,
  ScanRecordSchema,
  findingId,
  pageStateId,
  scanId,
  type Finding,
  type FindingInput,
  type Report,
  type ScanRecord,
} from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { buildReport } from './build-report.js';
import { SARIF_LEVEL_FOR_TIER, renderSarif } from './sarif.js';

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
    element: { selector: 'main > img:nth-of-type(1)', xpath: '/html[1]/body[1]/img[1]' },
    page: { url: 'https://example.com/', pageStateId: pageStateId('st_1'), viewport: 'desktop' },
    verification: { method: 'none', status: 'unverified' },
    description: 'Image has no text alternative.',
    ...overrides,
  } satisfies FindingInput);
}

function aiFinding(overrides: Partial<FindingInput> = {}): Finding {
  return finding({
    id: findingId('find_ai_1'),
    checkId: 'ai.link-purpose',
    source: 'ai-text',
    sc: ['2.4.4'],
    scPrimary: '2.4.4',
    tier: 'likely',
    confidence: 0.8,
    evidence: [{ kind: 'dom', excerpt: '<a>Click here</a>', selector: 'a' }],
    verification: { method: 'model-verifier', status: 'confirmed' },
    description: 'Link text "Click here" does not describe its destination.',
    ...overrides,
  });
}

function record(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return ScanRecordSchema.parse({
    id: scanId('scan_1'),
    target: { kind: 'url', url: 'https://example.com/' },
    options: { mode: 'deterministic' },
    status: 'completed',
    phase: 'report',
    createdAt: '2026-07-25T10:00:00.000Z',
    ...overrides,
  });
}

function reportWith(findings: readonly Finding[], scan: ScanRecord = record()): Report {
  return ReportSchema.parse(
    buildReport({
      scan,
      findings,
      toolVersion: '9.9.9-test',
      generatedAt: new Date('2026-07-25T12:00:00.000Z'),
    }),
  );
}

describe('renderSarif', () => {
  it('emits a 2.1.0 log with one run', () => {
    const log = renderSarif(reportWith([]));
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe('Handrail');
    expect(log.runs[0]?.tool.driver.version).toBe('9.9.9-test');
  });

  it('never lets an AI finding become a SARIF error', () => {
    // The tier ceilings exist so that "a model said so and a second one agreed"
    // stays visibly different from "we measured it". Collapsing `likely` into
    // `error` would undo the whole verdict pipeline at the very last step.
    expect(SARIF_LEVEL_FOR_TIER.violation).toBe('error');
    expect(SARIF_LEVEL_FOR_TIER.likely).toBe('warning');
    expect(SARIF_LEVEL_FOR_TIER['needs-review']).toBe('note');

    const log = renderSarif(reportWith([aiFinding()]));
    expect(log.runs[0]?.results[0]?.level).toBe('warning');
  });

  it('registers one rule per check and points every result at its index', () => {
    const log = renderSarif(
      reportWith([
        finding({ id: findingId('find_1') }),
        finding({ id: findingId('find_2') }),
        finding({
          id: findingId('find_3'),
          checkId: 'ptr.target-size',
          source: 'heuristic:ptr.target-size',
          sc: ['2.5.8'],
          scPrimary: '2.5.8',
        }),
      ]),
    );
    const run = log.runs[0];
    expect(run?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      'axe.image-alt',
      'ptr.target-size',
    ]);
    for (const result of run?.results ?? []) {
      expect(run?.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
    }
  });

  it('carries the tier and the source into the message a reviewer reads', () => {
    const log = renderSarif(reportWith([aiFinding()]));
    const message = log.runs[0]?.results[0]?.message.text ?? '';
    expect(message).toContain('[likely]');
    expect(message).toContain('ai-text');
    expect(message).toContain('2.4.4');
  });

  it('tags results with their criteria and conformance level', () => {
    const log = renderSarif(reportWith([finding({ sc: ['2.4.3'], scPrimary: '2.4.3' })]));
    const tags = log.runs[0]?.tool.driver.rules[0]?.properties.tags ?? [];
    expect(tags).toContain('accessibility');
    expect(tags).toContain('wcag:2.4.3');
    expect(tags).toContain('wcag2a');
    expect(tags).toContain('handrail-tier:violation');
  });

  it('fingerprints results so a re-run updates an alert instead of opening another', () => {
    const subject = finding();
    const once = renderSarif(reportWith([subject]));
    const twice = renderSarif(reportWith([subject]));
    expect(once.runs[0]?.results[0]?.partialFingerprints).toEqual(
      twice.runs[0]?.results[0]?.partialFingerprints,
    );
    expect(once.runs[0]?.results[0]?.partialFingerprints.elemFingerprint).toBe(subject.id);
  });

  it('reports a degradation as a notification, not as a finding about the site', () => {
    const log = renderSarif(
      reportWith(
        [],
        record({
          degradations: [
            {
              reason: 'model-unavailable',
              detail: 'the provider returned 529',
              phase: 'judge-text',
              at: '2026-07-25T11:59:00.000Z',
            },
          ],
        }),
      ),
    );
    expect(log.runs[0]?.results).toHaveLength(0);
    const notifications = log.runs[0]?.invocations[0]?.toolExecutionNotifications ?? [];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message.text).toContain('model-unavailable');
  });

  it('locates a finding at the page it was found on', () => {
    const subject = finding();
    const log = renderSarif(reportWith([subject]));
    const location = log.runs[0]?.results[0]?.locations[0];
    expect(location?.physicalLocation.artifactLocation.uri).toBe(subject.page.url);
    expect(location?.logicalLocations?.[0]?.name).toBe(subject.element?.selector);
  });

  it('marks a failed scan as an unsuccessful invocation', () => {
    const log = renderSarif(reportWith([], record({ status: 'failed' })));
    expect(log.runs[0]?.invocations[0]?.executionSuccessful).toBe(false);
  });

  it('correlates re-runs under a stable automation id', () => {
    expect(renderSarif(reportWith([])).runs[0]?.automationDetails.id).toBe('handrail/scan_1');
    expect(
      renderSarif(reportWith([]), { automationId: 'pr-42' }).runs[0]?.automationDetails.id,
    ).toBe('pr-42');
  });
});
