import { type ModelErrorCode } from '@handrail/schemas';

import { ModelError } from '../errors.js';
import { DETERMINISTIC_MODEL } from '../models.js';
import {
  type ModelClient,
  type ModelCompletion,
  type RawTokenUsage,
  type ResolvedModelRequest,
} from '../types.js';

/**
 * What a responder decides to do with a request: either produce a completion, or
 * fail with a specific error code (how the deterministic backend simulates every
 * provider failure mode in tests without a network).
 */
export type DeterministicOutcome =
  | { kind: 'respond'; output?: unknown; text?: string; usage?: Partial<RawTokenUsage> }
  | { kind: 'error'; code: ModelErrorCode; message?: string };

/** Return an outcome to handle a request, or `undefined` to defer to the next responder. */
export type DeterministicResponder = (
  request: ResolvedModelRequest,
) => DeterministicOutcome | undefined;

/** The non-error branch, after a failing outcome has already been thrown. */
type RespondOutcome = Extract<DeterministicOutcome, { kind: 'respond' }>;

/**
 * Thrown for a *misconfigured* deterministic client — e.g. a structured request
 * with no responder to answer it. This is a test-setup bug, distinct from the
 * `ModelError`s that model runtime failures, and it should never be caught and
 * turned into a degradation: fix the fixture instead.
 */
export class DeterministicConfigError extends Error {
  override readonly name = 'DeterministicConfigError';
}

export interface DeterministicClientOptions {
  /** Consulted in order; the first to return an outcome handles the request. */
  responders?: DeterministicResponder[];
  /** Synthesize token usage. The default is deterministic in the input's length. */
  usage?: (request: ResolvedModelRequest, text: string) => RawTokenUsage;
}

const CHARS_PER_TOKEN = 4;

function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

/** Rough input size from a request's text content. Images are not modelled — this is a $0 stub. */
function inputChars(request: ResolvedModelRequest): number {
  let chars = request.system?.length ?? 0;
  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      for (const block of message.content) {
        if (block.type === 'text') chars += block.text.length;
      }
    }
  }
  return chars;
}

function defaultUsage(request: ResolvedModelRequest, text: string): RawTokenUsage {
  return { input: estimateTokens(inputChars(request)), output: estimateTokens(text.length) };
}

/**
 * The `local-deterministic` backend: the eval and test backbone. It never touches
 * a network and always costs $0. Given the same request it returns the same
 * completion, so unit tests, the every-PR deterministic eval gate, and golden
 * snapshots all rest on it. Responders script its behaviour — including forcing
 * any provider failure — while honouring the same structured-output contract the
 * real providers do: a request with an `outputSchema` gets output parsed against
 * it, and output that does not parse fails as `schema-invalid`, exactly as a real
 * provider's native structured output would.
 */
export function createDeterministicClient(
  options: DeterministicClientOptions = {},
): ModelClient {
  const responders = options.responders ?? [];
  const usageFor = options.usage ?? defaultUsage;

  return {
    provider: 'local-deterministic',
    // Always settles as a promise — never throws synchronously — so it presents
    // the same surface a real async provider does, and the ledger's try/await
    // catches its failures the same way it would Anthropic's.
    complete(request: ResolvedModelRequest): Promise<ModelCompletion> {
      try {
        const outcome = firstOutcome(responders, request);
        if (outcome?.kind === 'error') {
          return Promise.reject(
            new ModelError(outcome.code, outcome.message, { provider: 'local-deterministic' }),
          );
        }

        const schema = request.outputSchema;
        const completion = schema
          ? structuredCompletion(request, schema, outcome, usageFor)
          : textCompletion(request, outcome, usageFor);
        return Promise.resolve(completion);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

function firstOutcome(
  responders: readonly DeterministicResponder[],
  request: ResolvedModelRequest,
): DeterministicOutcome | undefined {
  for (const responder of responders) {
    const outcome = responder(request);
    if (outcome !== undefined) return outcome;
  }
  return undefined;
}

function structuredCompletion(
  request: ResolvedModelRequest,
  schema: NonNullable<ResolvedModelRequest['outputSchema']>,
  outcome: RespondOutcome | undefined,
  usageFor: (request: ResolvedModelRequest, text: string) => RawTokenUsage,
): ModelCompletion {
  if (outcome === undefined) {
    throw new DeterministicConfigError(
      `deterministic client received a structured request (role "${request.role}", ` +
        `promptVersion "${request.promptVersion}") with no responder to answer it`,
    );
  }
  if (outcome.output === undefined) {
    throw new DeterministicConfigError(
      `deterministic responder for role "${request.role}" must return \`output\` for a ` +
        `structured request`,
    );
  }

  // Enforce the same guarantee a native structured output gives: the seam only
  // ever hands back schema-valid data, and a mismatch is a `schema-invalid` failure.
  const parsed = schema.safeParse(outcome.output);
  if (!parsed.success) {
    throw new ModelError('schema-invalid', parsed.error.message, {
      provider: 'local-deterministic',
    });
  }

  const text = outcome.text;
  return {
    model: DETERMINISTIC_MODEL,
    output: parsed.data,
    text,
    usage: { ...usageFor(request, text ?? ''), ...outcome.usage },
    cached: false,
  };
}

function textCompletion(
  request: ResolvedModelRequest,
  outcome: RespondOutcome | undefined,
  usageFor: (request: ResolvedModelRequest, text: string) => RawTokenUsage,
): ModelCompletion {
  const text =
    outcome?.text ??
    (typeof outcome?.output === 'string' ? outcome.output : `deterministic:${request.inputDigest.slice(0, 12)}`);

  return {
    model: DETERMINISTIC_MODEL,
    output: text,
    text,
    usage: { ...usageFor(request, text), ...outcome?.usage },
    cached: false,
  };
}
