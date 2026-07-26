import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CostLedger,
  FileCassetteStore,
  createBedrockClient,
  resolveModelMode,
  withCassettes,
  type ModelClient,
} from '@handrail/model';
import { scanId } from '@handrail/schemas';
import { beforeAll, describe, expect, it } from 'vitest';

import { StateCaptureSchema, type StateCapture } from '../capture/types.js';
import { runTextJudgment } from './run-text-judgment.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.join(HERE, '__fixtures__', 'seeded-demo-desktop.capture.json');

/** The committed corpus: recorded once against a real provider, replayed forever. */
export const CASSETTE_DIR = path.resolve(HERE, '..', '..', '..', 'model', 'cassettes');

/**
 * A client whose transport is the cassette layer.
 *
 * `wrapTransport` is what makes "no credentials" true rather than aspirational:
 * in replay the cassette layer never calls the inner transport, so the provider
 * SDK client — which throws when it cannot find credentials — is never
 * constructed at all. Re-record with `MODEL_MODE=record` and real credentials.
 */
function cassetteClient(): ModelClient {
  const store = new FileCassetteStore(CASSETTE_DIR);
  const mode = resolveModelMode();
  return createBedrockClient({
    wrapTransport: (inner) =>
      withCassettes(inner, { mode: mode === 'live' ? 'replay' : mode, store }),
  });
}

let capture: StateCapture;

beforeAll(async () => {
  capture = StateCaptureSchema.parse(JSON.parse(await readFile(CAPTURE, 'utf8')));
});

/**
 * The hybrid path against a **real recorded model response**, with no API key.
 *
 * `local-deterministic` proves the plumbing, but it is a synthetic stand-in: its
 * answers are whatever the test scripted, so it cannot catch a prompt that
 * stopped eliciting the right shape or a model that changed how it answers.
 * Replaying a real response can — and the first recording immediately did (see
 * the rejection test below).
 */
describe('the hybrid path replays with no credentials', () => {
  it('calls the judge and serves it from the corpus', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    const roles = ledger.invocations.map((invocation) => invocation.role);
    expect(roles).toContain('text-judge');
    expect(ledger.invocations.every((invocation) => invocation.ok)).toBe(true);
    // Real recorded token counts, so the ledger prices them — but nothing left
    // this machine, and no credential was read.
    expect(ledger.totalUsage.input).toBeGreaterThan(0);
  });

  it('completes without degrading — a replay miss would be a loud failure, not a shrug', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    const result = await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    expect(result.degradations).toEqual([]);
  });
});

/**
 * What the real model actually finds, pinned so it cannot regress unnoticed.
 *
 * This is the assertion that #69 was about. Against a real recorded response the
 * judge reaches the same two seeded defects the scripted suite does — gt-006
 * (link purpose, 2.4.4) and gt-013 (heading outline, 1.3.1) — at `likely`, which
 * requires the independent verifier to have confirmed them.
 *
 * It did **not** work before the grounding fix: the model cited `text` and `tag`
 * with exactly the values the snapshot held, and both were rejected because
 * grounding only looked inside `element.attributes`. Recall was zero, and only a
 * real recorded response could show it.
 */
describe('what the real model actually finds', () => {
  it('reaches gt-006 and gt-013 at `likely`, verifier-confirmed', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    const result = await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    expect(result.findings.map((finding) => finding.checkId).sort()).toEqual([
      'ai.heading-outline',
      'ai.link-purpose',
    ]);
    expect(result.findings.map((finding) => finding.tier)).toEqual(['likely', 'likely']);
    expect(new Set(result.findings.map((finding) => String(finding.scPrimary)))).toEqual(
      new Set(['2.4.4', '1.3.1']),
    );
    // `likely` is only reachable through the independent verifier.
    for (const finding of result.findings) {
      expect(finding.verification.status).toBe('confirmed');
    }
  });

  it('still rejects the claims the page does not support', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    const result = await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    // Widening grounding to cover `tag`/`text`/`role`/`accessibleName` did not
    // make it permissive: the model also claimed an `alt=""` on an image that
    // carries no `alt` at all, and that is still thrown out and ledgered.
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.candidatesSeen).toBe(result.findings.length + result.rejected.length);
  });

  it('keeps reported hallucinations structurally zero', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    const result = await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    // Whatever survives must be grounded in the real index and tier-capped.
    const indexed = new Set(capture.elements.map((element) => String(element.elemId)));
    for (const finding of result.findings) {
      expect(indexed.has(String(finding.element?.elementId))).toBe(true);
      expect(finding.tier).not.toBe('violation');
    }
  });
});
