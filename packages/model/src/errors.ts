import { type ModelErrorCode, type ModelProvider } from '@handrail/schemas';

/**
 * The error codes that describe a *transient* failure — the model might succeed
 * if the same call is made again. This is used to decide whether a retry is even
 * worth attempting; it is never used to fall back to a different result. Trust
 * invariant 1 is absolute: a call that cannot be completed throws, and the scan
 * is marked `degraded`. Retryability changes *how many times we throw*, not
 * *whether* we throw.
 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<ModelErrorCode> = new Set([
  'rate-limit',
  'overloaded',
  'timeout',
  'network',
]);

export interface ModelErrorOptions {
  /** Which provider raised it, when known. Deterministic failures have none. */
  provider?: ModelProvider;
  /** The underlying error, preserved for logs — never for control flow. */
  cause?: unknown;
  /**
   * Override the default retryability for the code. Providers occasionally know
   * more than the code alone does (e.g. a 429 with a zero `retry-after`).
   */
  retryable?: boolean;
}

/**
 * Every failure that crosses the provider seam is one of these. There is no
 * untyped escape hatch: `toModelError` funnels anything a provider throws into a
 * `ModelError` with a concrete `ModelErrorCode`, so callers can reason about the
 * failure without string-matching a message. The class carries the code, the
 * originating provider, and whether a retry could plausibly help — but not a way
 * to recover silently, which is the whole point.
 */
export class ModelError extends Error {
  override readonly name = 'ModelError';
  readonly code: ModelErrorCode;
  readonly provider: ModelProvider | undefined;
  readonly retryable: boolean;

  constructor(code: ModelErrorCode, message?: string, options: ModelErrorOptions = {}) {
    super(message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? RETRYABLE_ERROR_CODES.has(code);
  }
}

export function isModelError(value: unknown): value is ModelError {
  return value instanceof ModelError;
}

/**
 * Normalise anything thrown across the seam into a `ModelError`. An already-typed
 * error passes through untouched; anything else becomes a `provider-error` with
 * the original preserved as `cause`. Nothing reaches the ledger untyped.
 */
export function toModelError(value: unknown, provider?: ModelProvider): ModelError {
  if (isModelError(value)) return value;

  const message = value instanceof Error ? value.message : String(value);
  return new ModelError('provider-error', message, {
    ...(provider === undefined ? {} : { provider }),
    cause: value,
  });
}
