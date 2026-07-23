import { describe, expect, it } from 'vitest';

import {
  makeFinding,
  pixelEvidence,
  screenshotEvidence,
  toolEvidence,
} from './__test__/factories.js';
import { FindingSchema, minTier, tierCeilingFor } from './finding.js';

describe('the evidence invariant', () => {
  it('downgrades an AI finding with no evidence to needs-review', () => {
    const parsed = FindingSchema.parse(
      makeFinding({
        source: 'ai-vision',
        tier: 'violation',
        evidence: [],
        checkId: 'ai.alt-vs-image',
      }),
    );

    expect(parsed.tier).toBe('needs-review');
  });

  it('downgrades even when the model claims full confidence and a confirmed verification', () => {
    const parsed = FindingSchema.parse(
      makeFinding({
        source: ['ai-text'],
        tier: 'violation',
        confidence: 1,
        evidence: [],
        verification: { method: 'model-verifier', status: 'confirmed' },
      }),
    );

    expect(parsed.tier).toBe('needs-review');
  });

  it('leaves an AI finding that carries evidence alone', () => {
    const parsed = FindingSchema.parse(
      makeFinding({
        source: 'ai-vision',
        tier: 'likely',
        evidence: [screenshotEvidence],
      }),
    );

    expect(parsed.tier).toBe('likely');
  });

  it('does not touch deterministic findings, which the schema has no opinion about', () => {
    const parsed = FindingSchema.parse(
      makeFinding({ source: 'axe', tier: 'violation', evidence: [] }),
    );

    expect(parsed.tier).toBe('violation');
  });

  it('never raises a tier, only lowers it', () => {
    const parsed = FindingSchema.parse(
      makeFinding({ source: 'ai-text', tier: 'needs-review', evidence: [] }),
    );

    expect(parsed.tier).toBe('needs-review');
  });
});

describe('tierCeilingFor', () => {
  const confirmed = { method: 'model-verifier', status: 'confirmed' } as const;
  const unverified = { method: 'none', status: 'unverified' } as const;
  const rejected = { method: 'model-verifier', status: 'rejected' } as const;

  it('allows violation when a deterministic source measured it', () => {
    expect(
      tierCeilingFor({
        source: ['axe'],
        evidence: [toolEvidence],
        verification: confirmed,
      }),
    ).toBe('violation');
  });

  it('allows violation for heuristics backed by pixel math', () => {
    expect(
      tierCeilingFor({
        source: ['heuristic:kbd.focus-visible'],
        evidence: [pixelEvidence],
        verification: unverified,
      }),
    ).toBe('violation');
  });

  it('caps AI at likely even with a confirmed verifier and pixel evidence', () => {
    expect(
      tierCeilingFor({
        source: ['ai-vision'],
        evidence: [pixelEvidence, screenshotEvidence],
        verification: confirmed,
      }),
    ).toBe('likely');
  });

  it('caps a mixed deterministic + AI finding at likely', () => {
    expect(
      tierCeilingFor({
        source: ['axe', 'ai-text'],
        evidence: [toolEvidence],
        verification: confirmed,
      }),
    ).toBe('likely');
  });

  it('drops AI to needs-review when the verifier did not confirm', () => {
    expect(
      tierCeilingFor({
        source: ['ai-text'],
        evidence: [screenshotEvidence],
        verification: rejected,
      }),
    ).toBe('needs-review');
  });

  it('drops a deterministic source to needs-review when its only evidence is a picture', () => {
    expect(
      tierCeilingFor({
        source: ['heuristic:resp.reflow-320'],
        evidence: [screenshotEvidence],
        verification: unverified,
      }),
    ).toBe('needs-review');
  });
});

describe('minTier', () => {
  it('picks the more conservative of two tiers', () => {
    expect(minTier('violation', 'likely')).toBe('likely');
    expect(minTier('needs-review', 'violation')).toBe('needs-review');
    expect(minTier('likely', 'likely')).toBe('likely');
  });
});

describe('source', () => {
  it('normalises a single source to an array', () => {
    expect(FindingSchema.parse(makeFinding({ source: 'axe' })).source).toEqual(['axe']);
  });

  it('accepts a well-formed heuristic source', () => {
    const parsed = FindingSchema.parse(
      makeFinding({ source: 'heuristic:ptr.target-size', checkId: 'ptr.target-size' }),
    );

    expect(parsed.source).toEqual(['heuristic:ptr.target-size']);
  });

  it('rejects a heuristic source with no check id', () => {
    expect(() => FindingSchema.parse(makeFinding({ source: 'heuristic:' }))).toThrow();
  });

  it('rejects an unknown source', () => {
    expect(() => FindingSchema.parse(makeFinding({ source: 'vibes' }))).toThrow();
  });

  it('rejects an empty source list', () => {
    expect(() => FindingSchema.parse(makeFinding({ source: [] }))).toThrow();
  });
});

describe('criterion references', () => {
  it('rejects a scPrimary that is not among the listed criteria', () => {
    expect(() =>
      FindingSchema.parse(makeFinding({ sc: ['1.1.1', '1.3.1'], scPrimary: '2.4.7' })),
    ).toThrow(/scPrimary must be one of/);
  });

  it('accepts a scPrimary drawn from the list', () => {
    const parsed = FindingSchema.parse(makeFinding({ sc: ['1.1.1', '1.3.1'], scPrimary: '1.3.1' }));

    expect(parsed.scPrimary).toBe('1.3.1');
  });

  it('rejects a malformed criterion number', () => {
    expect(() => FindingSchema.parse(makeFinding({ sc: ['1.1'], scPrimary: '1.1' }))).toThrow();
  });
});

describe('defaults', () => {
  it('treats a finding as standing for one instance unless told otherwise', () => {
    expect(FindingSchema.parse(makeFinding()).dedupeCount).toBe(1);
  });

  it('marks remediation wording as authored, not suggested, by default', () => {
    const parsed = FindingSchema.parse(
      makeFinding({ remediation: { summary: 'Add an alt attribute.' } }),
    );

    expect(parsed.remediation?.suggested).toBe(false);
    expect(parsed.remediation?.snippets).toEqual({});
  });
});
