import { describe, expect, it } from 'vitest';

import { makeFinding, makeScanRecord, screenshotEvidence } from './__test__/factories.js';
import { ScanEventSchema } from './events.js';
import { FindingSchema } from './finding.js';
import { ModelInvocationSchema } from './model.js';
import { ReportSchema } from './report.js';
import { ScanRecordSchema } from './scan.js';

/**
 * Everything Handrail emits goes to disk or over the wire as JSON and comes back.
 * A schema that cannot survive that trip will corrupt a report the first time
 * someone reloads one, so the round trip is a contract, not a nicety.
 */
function roundTrip<T>(schema: { parse: (value: unknown) => T }, input: unknown): [T, T] {
  const first = schema.parse(input);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  return [first, second];
}

const modelInvocation = {
  id: 'inv_1',
  scanId: 'scan_1',
  correlationId: 'scan_1',
  role: 'text-judge',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  promptVersion: 'text-judge@3',
  inputDigest: 'a'.repeat(64),
  usage: { input: 4200, output: 900 },
  costUsd: 0.0087,
  latencyMs: 1840,
  startedAt: '2026-07-23T10:00:03.000Z',
  ok: true,
};

describe('JSON round trip', () => {
  it('preserves a finding', () => {
    const [first, second] = roundTrip(FindingSchema, makeFinding());

    expect(second).toEqual(first);
  });

  it('preserves a finding that the evidence invariant downgraded', () => {
    const [first, second] = roundTrip(
      FindingSchema,
      makeFinding({ source: 'ai-vision', tier: 'violation', evidence: [] }),
    );

    expect(first.tier).toBe('needs-review');
    expect(second).toEqual(first);
  });

  it('preserves a scan record, including its defaults', () => {
    const [first, second] = roundTrip(ScanRecordSchema, makeScanRecord());

    expect(second).toEqual(first);
    expect(first.counts.findingsTotal).toBe(0);
  });

  it('preserves a model invocation', () => {
    const [first, second] = roundTrip(ModelInvocationSchema, modelInvocation);

    expect(second).toEqual(first);
  });

  it('preserves each event shape', () => {
    const events = [
      { type: 'phase.started', phase: 'capture' },
      { type: 'finding.detected', finding: makeFinding() },
      {
        type: 'screenshot.captured',
        artifactId: 'art_1',
        pageStateId: 'state_1',
        url: 'https://example.com/',
        viewport: 'desktop',
      },
      { type: 'model.invoked', invocation: modelInvocation },
      { type: 'log', level: 'info', message: 'captured 5 states' },
    ];

    for (const [index, partial] of events.entries()) {
      const [first, second] = roundTrip(ScanEventSchema, {
        scanId: 'scan_1',
        seq: index,
        ts: '2026-07-23T10:00:00.000Z',
        ...partial,
      });

      expect(second).toEqual(first);
    }
  });

  it('preserves a whole report', () => {
    const report = {
      reportVersion: 1,
      generatedAt: '2026-07-23T10:05:00.000Z',
      tool: { name: 'handrail', version: '0.0.0' },
      scan: makeScanRecord(),
      findings: [
        makeFinding(),
        makeFinding({
          id: 'find_2',
          source: 'ai-vision',
          checkId: 'ai.alt-vs-image',
          tier: 'likely',
          severity: 'serious',
          confidence: 0.82,
          evidence: [screenshotEvidence],
          verification: { method: 'model-verifier', status: 'confirmed' },
          description: 'Alt text describes a football match; the image shows a dinner table.',
        }),
      ],
      scRollups: [
        {
          sc: '1.1.1',
          level: 'A',
          status: 'fail',
          findingIds: ['find_1', 'find_2'],
          checksRun: ['axe.image-alt', 'ai.alt-vs-image'],
          rationale: 'Two images lack a usable text alternative.',
        },
      ],
      coverage: {
        criteriaTotal: 55,
        evaluated: 38,
        passVerified: 24,
        failed: 6,
        needsReview: 8,
        notApplicable: 0,
        notTested: 17,
        manualRequired: ['1.2.1'],
      },
      trendScore: { value: 78.4 },
    };

    const [first, second] = roundTrip(ReportSchema, report);

    expect(second).toEqual(first);
    expect(first.findings).toHaveLength(2);
  });
});

describe('parsing is idempotent', () => {
  it('reparsing a parsed finding changes nothing', () => {
    const once = FindingSchema.parse(makeFinding({ source: 'axe' }));
    const twice = FindingSchema.parse(once);

    expect(twice).toEqual(once);
  });

  it('reparsing a parsed scan record changes nothing', () => {
    const once = ScanRecordSchema.parse(makeScanRecord());
    const twice = ScanRecordSchema.parse(once);

    expect(twice).toEqual(once);
  });
});
