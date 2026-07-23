import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Finding } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { scriptedClient, testLedger } from '../__test__/factories.js';
import { StateCaptureSchema, type StateCapture } from '../capture/types.js';
import { buildElementExtract } from './element-extract.js';
import { runTextJudgment } from './run-text-judgment.js';
import type { TextJudgeCandidate } from './text-judge-schema.js';

/**
 * The acceptance suite for issue #10, run against a **real capture of the real
 * fixture app** — committed by `pnpm --filter @handrail/engine capture:seeded-demo`
 * and re-derived by `seeded-demo.browser.test.ts`, which fails if it has drifted.
 *
 * The model is `local-deterministic`, so this costs $0, needs no key and gives
 * the same answer on every platform. What is being tested is the pipeline, not
 * the model: the scripted judge below reads the extract it was actually sent and
 * emits candidates from it, including the kind of confident nonsense a real
 * model produces. Everything downstream has to sort the two apart.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = new URL('../../../../', import.meta.url);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const capture: StateCapture = StateCaptureSchema.parse(
  readJson(`${here}__fixtures__/seeded-demo-desktop.capture.json`),
);
const anchors = readJson<Record<string, string>>(`${here}__fixtures__/seeded-demo-anchors.json`);

interface GroundTruthEntry {
  id: string;
  scPrimary: string;
  detectableBy: string[];
  expectedCheckIds: string[];
  expectedTier: string;
}
const groundTruth = readJson<{ expected: GroundTruthEntry[]; traps: { id: string }[] }>(
  fileURLToPath(new URL('fixtures/apps/seeded-demo/ground-truth.json', repoRoot)),
);

/** The ground-truth entries this layer is the one responsible for catching. */
const AI_TEXT_EXPECTATIONS = groundTruth.expected.filter((entry) =>
  entry.detectableBy.includes('ai-text'),
);

/** `elemId` of the element `ground-truth.json` points at, via its xpath. */
function elemIdFor(groundTruthId: string): string {
  const xpath = anchors[groundTruthId];
  const record = capture.elements.find((el) => el.xpath === xpath);
  if (record === undefined) throw new Error(`${groundTruthId} is not in the committed capture`);
  return String(record.elemId);
}

function findingFor(findings: readonly Finding[], groundTruthId: string): Finding | undefined {
  return findings.find((finding) => finding.element?.xpath === anchors[groundTruthId]);
}

interface ProjectedElement {
  id: string;
  tag: string;
  role: string | null;
  name: string | null;
  text: string | null;
  attrs: Record<string, string>;
}

const UNINFORMATIVE = new Set(['click here', 'read more', 'here', 'more']);

/**
 * A scripted text judge.
 *
 * It parses the payload it was sent rather than being handed the answers, so the
 * element ids it cites are the ones the extract really emitted — if the extract
 * stopped including the "Click here" link, this test would fail rather than pass
 * on a hardcoded id. Alongside the real claims it makes the four mistakes a real
 * model makes: a claim about an element that does not exist, a fabricated quote,
 * a claim about a correct trap, and a hedged claim it cannot support.
 */
function scriptedJudge(userText: string): { candidates: TextJudgeCandidate[] } {
  const elements = userText
    .split('\n')
    .filter((line) => line.startsWith('{"id":'))
    .map((line) => JSON.parse(line) as ProjectedElement);

  const candidates: TextJudgeCandidate[] = [];
  const push = (candidate: Omit<TextJudgeCandidate, 'claimedAttributes'> & Partial<Pick<TextJudgeCandidate, 'claimedAttributes'>>): void => {
    candidates.push({ claimedAttributes: [], ...candidate });
  };

  let deepestSoFar = 0;
  for (const el of elements) {
    const level = /^h([1-6])$/.exec(el.tag)?.[1];

    if (el.tag === 'a' && UNINFORMATIVE.has((el.name ?? '').toLowerCase())) {
      push({
        family: 'link-purpose',
        elemId: el.id,
        quotedDom: `<a href="${el.attrs.href ?? ''}">${el.text ?? ''}</a>`,
        claimedAttributes: [{ name: 'href', value: el.attrs.href ?? '' }],
        problem: `The link is announced as "${el.name ?? ''}", which names no destination. In a screen reader's link list the sentence that gave it meaning is gone.`,
        remediation: 'Name the destination in the link text itself.',
        confidence: 0.86,
      });
    }

    if (level !== undefined) {
      const numeric = Number(level);
      if (numeric - deepestSoFar > 1) {
        push({
          family: 'heading-outline',
          elemId: el.id,
          problem: `The outline jumps to h${level}, leaving a hole where a section heading should be.`,
          confidence: 0.74,
        });
      }
      deepestSoFar = numeric;
    }

    if (
      el.tag === 'input' &&
      el.attrs.placeholder !== undefined &&
      (el.name ?? '') === el.attrs.placeholder
    ) {
      push({
        family: 'label-quality',
        elemId: el.id,
        claimedAttributes: [{ name: 'placeholder', value: el.attrs.placeholder }],
        problem: 'The field is named only by its placeholder, which disappears as soon as the user types.',
        confidence: 0.81,
      });
    }

    // Two claims about elements that are *correct* — the fixture's traps. A model
    // that cannot tell an empty alt from a missing one produces the first, and one
    // that assumes any control near text is unlabelled produces the second.
    if (el.tag === 'img' && el.attrs.alt === '') {
      push({
        family: 'alt-text-triage',
        elemId: el.id,
        problem: 'This image has no text alternative.',
        confidence: 0.62,
      });
    }
    if (el.tag === 'select') {
      push({
        family: 'label-quality',
        elemId: el.id,
        problem: 'This control appears to have no label.',
        confidence: 0.55,
      });
    }

    // A hedged claim about an ordinary link. Nothing decides it deterministically,
    // so it reaches the verifier — which is where it should die.
    if (el.tag === 'a' && el.name === 'Contact') {
      push({
        family: 'link-purpose',
        elemId: el.id,
        problem: 'This link may be unclear to some users.',
        confidence: 0.44,
      });
    }
  }

  // Confident nonsense: an element id that is not in the index at all.
  push({
    family: 'link-purpose',
    elemId: 'e9999',
    problem: 'The "Reservations" link in the footer gives no indication of where it goes.',
    confidence: 0.91,
  });

  // A real element, a fabricated quote.
  const realLink = elements.find((el) => el.tag === 'a');
  if (realLink !== undefined) {
    push({
      family: 'link-purpose',
      elemId: realLink.id,
      quotedDom: '<a href="/reservations" class="cta">Book your table for this evening</a>',
      problem: 'The link text repeats the surrounding paragraph.',
      confidence: 0.7,
    });
  }

  return { candidates };
}

/** Answers the rubric from the facts it is shown. Hedged claims do not survive it. */
function scriptedVerifier(userText: string): unknown {
  const hedged = /\bmay be\b|\bappears to\b|\bmight\b/i.test(userText);
  return {
    elementMatchesClaim: true,
    problemPresentInEvidence: !hedged,
    criterionApplies: true,
    holds: !hedged,
    reason: hedged
      ? 'the claim is hedged and nothing in the facts settles it'
      : 'the facts shown contain the problem described',
  };
}

async function runFixture() {
  const ledger = testLedger();
  return {
    ledger,
    result: await runTextJudgment(
      {
        ledger,
        client: scriptedClient({ 'text-judge': scriptedJudge }),
        verifierClient: scriptedClient({ verifier: scriptedVerifier }),
      },
      capture,
    ),
  };
}

describe('the committed seeded-demo capture', () => {
  it('is a real, schema-valid capture of the fixture app', () => {
    expect(capture.url).toBe('http://localhost:5178/');
    expect(capture.elements.length).toBeGreaterThan(50);
    // gt-011: the fixture declares no lang, which is why 3.1.1 fails on it.
    expect(capture.documentLang).toBeNull();
  });

  it('puts every ai-text ground-truth element into the judge extract', () => {
    const extract = buildElementExtract(capture);
    const ids = new Set(extract.elements.map((el) => el.id));
    for (const entry of AI_TEXT_EXPECTATIONS) {
      expect(ids, `${entry.id} must reach the judge`).toContain(elemIdFor(entry.id));
    }
  });

  it('fits the batched call inside the per-state text budget', () => {
    const extract = buildElementExtract(capture);
    expect(extract.truncated).toBe(false);
    // The plan budgets ≤8K input per state, prefix included.
    expect(extract.estimatedTokens).toBeLessThan(6000);
  });
});

describe('the verdict pipeline over the seeded demo', () => {
  it('finds gt-006 (link purpose) at `likely`', async () => {
    const { result } = await runFixture();
    const finding = findingFor(result.findings, 'gt-006');

    expect(finding, 'gt-006 must be reported').toBeDefined();
    expect(finding?.tier).toBe('likely');
    expect(finding?.checkId).toBe('ai.link-purpose');
    expect(finding?.scPrimary).toBe('2.4.4');
    expect(finding?.source).toEqual(['ai-text']);
    expect(finding?.verification.status).toBe('confirmed');
    expect(finding?.verification.method).toBe('deterministic-recheck+model-verifier');
  });

  it('finds gt-013 (heading outline) at `likely`', async () => {
    const { result } = await runFixture();
    const finding = findingFor(result.findings, 'gt-013');

    expect(finding, 'gt-013 must be reported').toBeDefined();
    expect(finding?.tier).toBe('likely');
    expect(finding?.checkId).toBe('ai.heading-outline');
    expect(finding?.scPrimary).toBe('1.3.1');
    expect(finding?.verification.note).toContain('skipping a level');
  });

  it('matches every ai-text expectation in ground-truth.json', async () => {
    const { result } = await runFixture();
    for (const entry of AI_TEXT_EXPECTATIONS) {
      const finding = findingFor(result.findings, entry.id);
      expect(finding, `${entry.id} (${entry.scPrimary}) must be reported`).toBeDefined();
      expect(finding?.tier, entry.id).toBe(entry.expectedTier);
      expect(entry.expectedCheckIds, entry.id).toContain(finding?.checkId);
    }
  });

  it('rejects a candidate naming a nonexistent element and ledgers it', async () => {
    const { result } = await runFixture();

    const invented = result.rejected.find((entry) => entry.claimedElemId === 'e9999');
    expect(invented, 'the invented element must be ledgered').toBeDefined();
    expect(invented?.stage).toBe('grounding');
    expect(invented?.reason).toBe('unknown-element');
    // Confidently wrong: the ledger records that too, which is the point of it.
    expect(invented?.confidence).toBeGreaterThan(0.9);

    expect(result.findings.some((f) => f.element?.elementId === undefined)).toBe(false);
  });

  it('rejects a fabricated DOM quote about a real element', async () => {
    const { result } = await runFixture();
    const rejected = result.rejected.find((entry) => entry.reason === 'dom-quote-mismatch');
    expect(rejected).toBeDefined();
    expect(rejected?.stage).toBe('grounding');
  });

  it('reports structurally zero hallucinations', async () => {
    const { result } = await runFixture();
    const indexed = new Map(capture.elements.map((el) => [String(el.elemId), el]));

    for (const finding of result.findings) {
      // Every reported element exists in the capture, with the snapshot's own
      // selector and xpath — not the model's description of them.
      const record = indexed.get(String(finding.element?.elementId));
      expect(record, finding.id).toBeDefined();
      expect(finding.element?.xpath).toBe(record?.xpath);
      expect(finding.element?.selector).toBe(record?.selector);

      // Every AI finding carries evidence, and above needs-review it is verified.
      expect(finding.evidence.length).toBeGreaterThan(0);
      if (finding.tier !== 'needs-review') {
        expect(finding.verification.status).toBe('confirmed');
      }
      // The hard matrix: an AI source can never reach `violation`.
      expect(finding.tier).not.toBe('violation');
    }
  });

  it('reports none of the fixture traps', async () => {
    const { result } = await runFixture();
    const trapXpaths = new Set(groundTruth.traps.map((trap) => anchors[trap.id]));

    for (const finding of result.findings) {
      expect(trapXpaths, `${finding.checkId} flagged a trap`).not.toContain(finding.element?.xpath);
    }

    // …and the claims about them were ledgered rather than silently dropped.
    const refuted = result.rejected.filter((entry) => entry.reason === 'recheck-refuted');
    expect(refuted.length).toBeGreaterThanOrEqual(2);
    expect(refuted.map((entry) => entry.family)).toContain('alt-text-triage');
    expect(refuted.map((entry) => entry.family)).toContain('label-quality');
  });

  it('drops a hedged claim at the verifier', async () => {
    const { result } = await runFixture();
    const declined = result.rejected.find((entry) => entry.reason === 'verifier-rejected');
    expect(declined).toBeDefined();
    expect(declined?.stage).toBe('verification');
    expect(declined?.claim).toContain('may be unclear');
  });

  it('spends one batched judge call and one verifier call per surviving candidate', async () => {
    const { ledger, result } = await runFixture();
    const judgeCalls = ledger.invocations.filter((row) => row.role === 'text-judge');
    const verifierCalls = ledger.invocations.filter((row) => row.role === 'verifier');

    expect(judgeCalls).toHaveLength(1);
    // Only candidates that survived grounding and the re-check reach a verifier.
    expect(verifierCalls.length).toBeLessThan(result.candidatesSeen);
    expect(verifierCalls.length).toBeGreaterThanOrEqual(result.findings.length);
    expect(ledger.totalCostUsd).toBe(0);
  });
});
