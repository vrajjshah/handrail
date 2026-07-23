import type { CostLedger, ModelClient } from '@handrail/model';
import type { ModelInvocation } from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';
import { sanitizeForPrompt, sanitizeOptional } from '../judge/sanitize.js';
import { VERIFIER_PROMPT_VERSION, VERIFIER_SYSTEM } from '../judge/prompts.js';
import { VerifierOutputSchema, type VerifierOutput } from '../judge/text-judge-schema.js';
import type { GroundedCandidate } from './grounding.js';

export interface VerifierDeps {
  ledger: CostLedger;
  client: ModelClient;
}

export interface VerifierVerdict extends VerifierOutput {
  invocation: ModelInvocation;
}

/** The plan's verifier budget: ≤2K input, 300 output. */
const MAX_OUTPUT_TOKENS = 300;

/**
 * The element facts, re-read from the snapshot.
 *
 * Note what is *not* here: the judge's reasoning, its confidence, the other
 * candidates, or the rest of the page. The verifier is only independent if it
 * cannot see the argument it is checking — otherwise it is a second signature on
 * the same sentence, and two correlated model calls dressed up as corroboration
 * are worse than one honest one.
 */
export function renderVerifierUser(grounded: GroundedCandidate, capture: StateCapture): string {
  const { element, spec, candidate } = grounded;

  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => `  ${name} = ${JSON.stringify(sanitizeForPrompt(value, 160))}`)
    .join('\n');

  const facts = [
    `tag: ${element.tag}`,
    `role: ${element.role ?? '(none)'}`,
    `accessible name: ${JSON.stringify(sanitizeOptional(element.accessibleName))}`,
    `own text: ${JSON.stringify(sanitizeOptional(element.text))}`,
    `visible: ${String(element.visible)}`,
    `attributes:\n${attributes.length > 0 ? attributes : '  (none)'}`,
    `page title: ${JSON.stringify(sanitizeForPrompt(capture.title))}`,
    `page language: ${capture.documentLang === null ? '(none declared)' : JSON.stringify(sanitizeForPrompt(capture.documentLang, 32))}`,
  ].join('\n');

  return `CLAIM
criterion: WCAG ${spec.sc.join(', ')}
question the claim answers: ${spec.question}
problem asserted: ${sanitizeForPrompt(candidate.problem, 600)}

ELEMENT FACTS (read from the captured page snapshot)
${facts}

Answer the rubric.`;
}

/**
 * Stage 3b: an independent model verifier, in a fresh context.
 *
 * "Fresh context" is the entire point and it is structural, not a prompt
 * instruction: this is a separate call, on a separate system prefix, whose user
 * turn is rendered from the *snapshot* rather than from the judge's output. The
 * only thing that crosses over is the sentence describing the claim, because
 * there is no way to verify a claim without stating it.
 *
 * A verifier that declines is not an error — it is the mechanism working. The
 * candidate is dropped to the hallucination ledger and never reaches the report.
 */
export async function verifyCandidate(
  deps: VerifierDeps,
  grounded: GroundedCandidate,
  capture: StateCapture,
): Promise<VerifierVerdict> {
  const result = await deps.ledger.invoke(deps.client, {
    role: 'verifier',
    promptVersion: VERIFIER_PROMPT_VERSION,
    system: VERIFIER_SYSTEM,
    messages: [{ role: 'user', content: renderVerifierUser(grounded, capture) }],
    outputSchema: VerifierOutputSchema,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  return { ...result.output, invocation: result.invocation };
}
