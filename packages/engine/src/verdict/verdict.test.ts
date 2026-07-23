import { scanId } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { always, capture, element, scriptedClient, testLedger } from '../__test__/factories.js';
import type { TextJudgeCandidate } from '../judge/text-judge-schema.js';
import { bestMatchRatio, boundedLevenshtein, normalizeMarkup, similarity } from './fuzzy.js';
import { DOM_QUOTE_THRESHOLD, canonicalMarkup, groundCandidate } from './grounding.js';
import { buildHallucinationLedger } from './hallucination-ledger.js';
import { dedupeGrounded, runVerdictPipeline, verificationFor } from './pipeline.js';
import { headingOutline, recheckCandidate } from './rechecks.js';

function candidate(overrides: Partial<TextJudgeCandidate> = {}): TextJudgeCandidate {
  return {
    family: 'link-purpose',
    elemId: 'e1',
    claimedAttributes: [],
    problem: 'The link name carries no purpose out of context.',
    confidence: 0.8,
    ...overrides,
  };
}

const HELD = always({
  elementMatchesClaim: true,
  problemPresentInEvidence: true,
  criterionApplies: true,
  holds: true,
  reason: 'the accessible name is "click here", which names no destination',
});

const DECLINED = always({
  elementMatchesClaim: true,
  problemPresentInEvidence: false,
  criterionApplies: true,
  holds: false,
  reason: 'nothing in the facts shows the problem',
});

describe('fuzzy matching', () => {
  it('bounds the distance computation instead of filling the whole matrix', () => {
    expect(boundedLevenshtein('kitten', 'sitting', 10)).toBe(3);
    expect(boundedLevenshtein('kitten', 'sitting', 2)).toBe(3);
    expect(boundedLevenshtein('a'.repeat(400), 'b'.repeat(400), 5)).toBe(6);
  });

  it('scores identical strings at 1 and disjoint strings near 0', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abcdef', 'uvwxyz')).toBe(0);
  });

  it('treats a verbatim quote of the snapshot as a perfect match', () => {
    const html = '<html><body><a href="/menu">\n  Click here\n</a></body></html>';
    expect(bestMatchRatio('<a href="/menu">Click here</a>', html)).toBe(1);
  });

  it('normalises adversarial whitespace in linear time', () => {
    // The DOM snapshot this runs over is attacker-controlled, so a polynomial
    // pattern here is a denial of service, not a slow test. The naive
    // `/\s*([<>])\s*/g` takes ~1.6s on 60k spaces; this input is longer.
    const hostile = `<${' '.repeat(100_000)}>${' '.repeat(100_000)}x`;
    const started = Date.now();
    expect(normalizeMarkup(hostile)).toBe('<>x');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('scores a paraphrase below the grounding threshold', () => {
    const html = '<a href="/menu">Click here</a>';
    expect(bestMatchRatio('<a href="/booking">Reserve a table now</a>', html)).toBeLessThan(
      DOM_QUOTE_THRESHOLD,
    );
  });
});

describe('grounding', () => {
  const link = element({
    ordinal: 1,
    tag: 'a',
    role: 'link',
    accessibleName: 'Click here',
    text: 'Click here',
    attributes: { href: '/menu' },
  });
  const state = capture({
    elements: [link],
    html: `<html><body>${canonicalMarkup(link)}</body></html>`,
  });

  it('rejects a claim naming an element that is not in the index', () => {
    const outcome = groundCandidate(candidate({ elemId: 'e404' }), state);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.reason).toBe('unknown-element');
  });

  it('rejects markup that does not reproduce the snapshot', () => {
    const outcome = groundCandidate(
      candidate({ quotedDom: '<a href="/reservations">Reserve your table today</a>' }),
      state,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.reason).toBe('dom-quote-mismatch');
  });

  it('accepts markup quoted faithfully', () => {
    const outcome = groundCandidate(
      candidate({ quotedDom: '<a href="/menu">Click here</a>' }),
      state,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.grounded.domQuoteRatio).toBeGreaterThanOrEqual(DOM_QUOTE_THRESHOLD);
  });

  it('rejects a claim resting on an attribute the element does not carry', () => {
    const outcome = groundCandidate(
      candidate({ claimedAttributes: [{ name: 'aria-label', value: 'Menu' }] }),
      state,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.reason).toBe('attribute-absent');
  });

  it('rejects a claim that misquotes an attribute value', () => {
    const outcome = groundCandidate(
      candidate({ claimedAttributes: [{ name: 'href', value: '/somewhere-else' }] }),
      state,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.reason).toBe('attribute-value-mismatch');
  });

  it('re-reads attribute values from the snapshot rather than trusting the claim', () => {
    const outcome = groundCandidate(
      candidate({ claimedAttributes: [{ name: 'href', value: '/MENU' }] }),
      state,
    );
    expect(outcome.ok).toBe(true);
    // The claim wrote "/MENU"; what travels downstream is the page's own "/menu".
    if (outcome.ok) expect(outcome.grounded.groundedAttributes.href).toBe('/menu');
  });
});

describe('deterministic re-checks', () => {
  function ground(el: ReturnType<typeof element>, c: TextJudgeCandidate, state = capture({ elements: [el] })) {
    const outcome = groundCandidate({ ...c, elemId: String(el.elemId) }, state);
    if (!outcome.ok) throw new Error(`grounding failed: ${outcome.rejection.reason}`);
    return { grounded: outcome.grounded, state };
  }

  it('confirms a link whose accessible name is on the non-descriptive list', () => {
    const link = element({ tag: 'a', role: 'link', accessibleName: 'Click here', attributes: { href: '/x' } });
    const { grounded, state } = ground(link, candidate());
    expect(recheckCandidate(grounded, state).status).toBe('confirmed');
  });

  it('leaves an ordinary link name to the verifier rather than guessing', () => {
    const link = element({ tag: 'a', role: 'link', accessibleName: 'Book a table for four', attributes: { href: '/x' } });
    const { grounded, state } = ground(link, candidate());
    expect(recheckCandidate(grounded, state).status).toBe('inconclusive');
  });

  it('refutes a link-purpose claim aimed at something that is not a link', () => {
    const img = element({ tag: 'img', role: 'image', attributes: { alt: 'A table' } });
    const { grounded, state } = ground(img, candidate());
    expect(recheckCandidate(grounded, state).status).toBe('refuted');
  });

  it('confirms a control named only by its placeholder — the axe blind spot', () => {
    const input = element({
      tag: 'input',
      role: 'textbox',
      accessibleName: 'Email address',
      attributes: { type: 'email', placeholder: 'Email address' },
    });
    const { grounded, state } = ground(input, candidate({ family: 'label-quality' }));
    expect(recheckCandidate(grounded, state).status).toBe('confirmed');
  });

  it('refutes a label claim against a correctly labelled control (the fixture trap)', () => {
    const select = element({
      ordinal: 10,
      tag: 'select',
      role: 'combobox',
      accessibleName: 'Number of guests',
      attributes: { id: 'party-size' },
    });
    const label = element({ ordinal: 9, tag: 'label', text: 'Number of guests', attributes: { for: 'party-size' } });
    const state = capture({ elements: [label, select] });
    const { grounded } = ground(select, candidate({ family: 'label-quality' }), state);
    expect(recheckCandidate(grounded, state).status).toBe('refuted');
  });

  it('confirms a heading that skips a level and refutes one that does not', () => {
    const h1 = element({ ordinal: 1, tag: 'h1', role: 'heading', text: 'Supper club' });
    const h3 = element({ ordinal: 2, tag: 'h3', role: 'heading', text: 'From the kitchen' });
    const h2 = element({ ordinal: 3, tag: 'h2', role: 'heading', text: 'From the cellar' });
    const state = capture({ elements: [h1, h3, h2] });

    expect(headingOutline(state).map((entry) => entry.level)).toEqual([1, 3, 2]);

    const skipped = ground(h3, candidate({ family: 'heading-outline' }), state);
    expect(recheckCandidate(skipped.grounded, state).status).toBe('confirmed');

    const fine = ground(h2, candidate({ family: 'heading-outline' }), state);
    expect(recheckCandidate(fine.grounded, state).status).toBe('refuted');
  });

  it('refutes an alt-text claim against a correctly decorative image (the fixture trap)', () => {
    const decorative = element({ tag: 'img', role: 'none', attributes: { alt: '' } });
    const { grounded, state } = ground(decorative, candidate({ family: 'alt-text-triage' }));
    const result = recheckCandidate(grounded, state);
    expect(result.status).toBe('refuted');
    expect(result.detail).toContain('decorative');
  });

  it('confirms alt text that is a filename', () => {
    const img = element({ tag: 'img', role: 'image', attributes: { alt: 'DSC_0421.jpg' } });
    const { grounded, state } = ground(img, candidate({ family: 'alt-text-triage' }));
    expect(recheckCandidate(grounded, state).status).toBe('confirmed');
  });
});

describe('the tier matrix, as the pipeline applies it', () => {
  it('never lets a re-check alone raise an AI claim above needs-review', () => {
    const verification = verificationFor(
      { status: 'confirmed', detail: 'the name is "click here"' },
      undefined,
      'ai.link-purpose',
    );
    expect(verification.method).toBe('deterministic-recheck');
    expect(verification.status).toBe('unverified');
  });

  it('records both methods when the verifier agrees with the re-check', () => {
    const verification = verificationFor(
      { status: 'confirmed', detail: 'the name is "click here"' },
      true,
      'ai.link-purpose',
    );
    expect(verification.method).toBe('deterministic-recheck+model-verifier');
    expect(verification.status).toBe('confirmed');
    expect(verification.recheckedBy).toBe('ai.link-purpose');
  });
});

describe('dedupe', () => {
  it('collapses repeated claims about one element and keeps the most confident', () => {
    const link = element({ tag: 'a', role: 'link', accessibleName: 'Click here', attributes: { href: '/x' } });
    const state = capture({ elements: [link] });
    const grounded = [0.4, 0.9, 0.6].map((confidence) => {
      const outcome = groundCandidate(
        candidate({ elemId: String(link.elemId), confidence }),
        state,
      );
      if (!outcome.ok) throw new Error('grounding failed');
      return outcome.grounded;
    });

    const { merged, counts } = dedupeGrounded(grounded);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.candidate.confidence).toBe(0.9);
    expect([...counts.values()]).toEqual([3]);
  });
});

describe('runVerdictPipeline', () => {
  const link = element({
    ordinal: 1,
    tag: 'a',
    role: 'link',
    accessibleName: 'Click here',
    text: 'Click here',
    attributes: { href: '/menu' },
  });
  const state = capture({
    elements: [link],
    html: `<html><body>${canonicalMarkup(link)}</body></html>`,
  });

  it('reports a grounded, verified claim at `likely` and no higher', async () => {
    const ledger = testLedger();
    const result = await runVerdictPipeline(
      [candidate({ elemId: 'e1' })],
      state,
      { ledger, verifierClient: scriptedClient({ verifier: HELD }) },
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.tier).toBe('likely');
    expect(finding.source).toEqual(['ai-text']);
    expect(finding.checkId).toBe('ai.link-purpose');
    expect(finding.scPrimary).toBe('2.4.4');
    expect(finding.verification.status).toBe('confirmed');
  });

  it('builds evidence from the snapshot, not from what the model typed', async () => {
    const ledger = testLedger();
    const result = await runVerdictPipeline(
      [candidate({ elemId: 'e1', quotedDom: '<a href="/menu">Click here</a>' })],
      state,
      { ledger, verifierClient: scriptedClient({ verifier: HELD }) },
    );

    const evidence = result.findings[0]?.evidence[0];
    expect(evidence?.kind).toBe('dom');
    if (evidence?.kind === 'dom') expect(evidence.excerpt).toBe(canonicalMarkup(link));
  });

  it('rejects a candidate naming an element that does not exist, and ledgers it', async () => {
    const ledger = testLedger();
    const result = await runVerdictPipeline(
      [candidate({ elemId: 'e999' })],
      state,
      { ledger, verifierClient: scriptedClient({ verifier: HELD }) },
    );

    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('unknown-element');
    expect(result.rejected[0]?.stage).toBe('grounding');
    expect(result.rejected[0]?.claimedElemId).toBe('e999');
    // Never asked a verifier about an element that is not there.
    expect(ledger.invocations).toHaveLength(0);
  });

  it('drops a candidate the verifier declines', async () => {
    const ledger = testLedger();
    const result = await runVerdictPipeline(
      [candidate({ elemId: 'e1' })],
      state,
      { ledger, verifierClient: scriptedClient({ verifier: DECLINED }) },
    );

    expect(result.findings).toHaveLength(0);
    expect(result.rejected[0]?.stage).toBe('verification');
    expect(result.rejected[0]?.reason).toBe('verifier-rejected');
  });

  it('caps at needs-review, and says so, when the verifier is unreachable', async () => {
    const ledger = testLedger();
    const brokenVerifier = scriptedClient({});
    const result = await runVerdictPipeline([candidate({ elemId: 'e1' })], state, {
      ledger,
      // A structured request with no responder is a DeterministicConfigError, which
      // the pipeline treats like any other verifier failure: recorded, never hidden.
      verifierClient: brokenVerifier,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.tier).toBe('needs-review');
    expect(result.degradations[0]?.reason).toBe('verifier-unavailable');
  });

  it('caps at needs-review when the verifier is skipped entirely', async () => {
    const ledger = testLedger();
    const result = await runVerdictPipeline(
      [candidate({ elemId: 'e1' })],
      state,
      { ledger, verifierClient: scriptedClient({ verifier: HELD }) },
      { skipModelVerifier: true },
    );

    expect(result.findings[0]?.tier).toBe('needs-review');
    expect(ledger.invocations).toHaveLength(0);
  });
});

describe('the hallucination ledger', () => {
  it('counts rejections by stage and reason', () => {
    const ledger = buildHallucinationLedger({
      scanId: String(scanId('scan_test')),
      candidatesSeen: 4,
      generatedAt: new Date('2026-07-23T12:00:00.000Z'),
      entries: [
        {
          pageStateId: capture().pageStateId,
          url: 'https://example.com/',
          family: 'link-purpose',
          checkId: 'ai.link-purpose',
          claimedElemId: 'e999',
          stage: 'grounding',
          reason: 'unknown-element',
          detail: 'no such element',
          confidence: 0.9,
          claim: 'the link is unclear',
        },
        {
          pageStateId: capture().pageStateId,
          url: 'https://example.com/',
          family: 'alt-text-triage',
          checkId: 'ai.alt-text-triage',
          claimedElemId: 'e4',
          stage: 'recheck',
          reason: 'recheck-refuted',
          detail: 'alt="" is decorative',
          confidence: 0.7,
          claim: 'the image has no alternative',
        },
      ],
    });

    expect(ledger.counts).toEqual({
      candidates: 4,
      rejected: 2,
      byReason: { 'unknown-element': 1, 'recheck-refuted': 1 },
      byStage: { grounding: 1, recheck: 1 },
    });
  });
});
