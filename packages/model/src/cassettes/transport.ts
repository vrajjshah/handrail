import { type MessagesTransport } from '../providers/anthropic-messages.js';
import { type Cassette, type CassetteKey, type CassetteStore } from './types.js';

/**
 * `live` calls the provider; `record` calls it and saves the exchange; `replay`
 * serves committed cassettes and never touches a network. CI sets `replay`, which
 * is what lets the model-dependent suites run with no credentials at all.
 */
export type ModelMode = 'live' | 'record' | 'replay';

export class CassetteMissError extends Error {
  override readonly name = 'CassetteMissError';
  readonly key: CassetteKey;
  constructor(key: CassetteKey) {
    super(
      `no cassette recorded for role "${key.role}" promptVersion "${key.promptVersion}" ` +
        `inputDigest ${key.inputDigest.slice(0, 12)}… — run \`pnpm --filter @handrail/model cassettes:refresh\` ` +
        `with MODEL_MODE=record to capture it`,
    );
    this.key = key;
  }
}

export function resolveModelMode(env: Record<string, string | undefined> = process.env): ModelMode {
  const raw = env.MODEL_MODE?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === 'live') return 'live';
  if (raw === 'record' || raw === 'replay') return raw;
  throw new Error(`unknown MODEL_MODE "${raw}" — expected "live", "record" or "replay"`);
}

export interface CassetteTransportOptions {
  mode: ModelMode;
  store: CassetteStore;
  /** Clock seam so a recorded `recordedAt` is deterministic in tests. */
  now?: () => Date;
}

/**
 * Wrap a transport with the cassette layer. In `replay` the inner transport is
 * never called — a miss is a loud {@link CassetteMissError} rather than a silent
 * fall-through to the network, because a CI run that quietly reached a provider
 * would defeat the entire point of the corpus.
 */
export function withCassettes(
  inner: MessagesTransport,
  options: CassetteTransportOptions,
): MessagesTransport {
  const now = options.now ?? (() => new Date());

  return async (params, context) => {
    const key: CassetteKey = {
      role: context.role,
      promptVersion: context.promptVersion,
      inputDigest: context.inputDigest,
    };

    if (options.mode === 'replay') {
      const cassette = await options.store.read(key);
      if (cassette === undefined) throw new CassetteMissError(key);
      return cassette.response;
    }

    const response = await inner(params, context);

    if (options.mode === 'record') {
      const cassette: Cassette = {
        version: 1,
        key: { ...key, provider: context.provider, model: context.model },
        recordedAt: now().toISOString(),
        request: params,
        response,
      };
      await options.store.write(cassette);
    }

    return response;
  };
}
