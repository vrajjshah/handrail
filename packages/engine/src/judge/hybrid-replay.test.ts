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
 * What the recording actually revealed, pinned so it cannot change unnoticed.
 *
 * On this capture the real model raised three candidates and **every one cited
 * an attribute the element does not carry**, so grounding rejected all three and
 * the page yielded no AI findings at all. #10's suite shows gt-006/gt-013/gt-003
 * reaching `likely`, but those runs answer with *scripted* candidates that
 * ground by construction — the gap between the two is precisely the thing a
 * synthetic backend cannot show you.
 *
 * The trust core behaved correctly: nothing unsupported reached the report. The
 * open question is recall, and it belongs to the prompt, not to this layer.
 */
describe('what the real model actually did', () => {
  it('rejected every candidate at grounding, and reported none of them', async () => {
    const ledger = new CostLedger({ scanId: scanId('scan_replay') });

    const result = await runTextJudgment(
      { ledger, client: cassetteClient(), verifierClient: cassetteClient() },
      capture,
    );

    expect(result.candidatesSeen).toBeGreaterThan(0);
    expect(result.rejected).toHaveLength(result.candidatesSeen);
    expect(result.findings).toHaveLength(0);
    expect(new Set(result.rejected.map((entry) => entry.reason))).toEqual(
      new Set(['attribute-absent']),
    );
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
