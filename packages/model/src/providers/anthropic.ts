import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

import { type ModelClient } from '../types.js';
import { createMessagesClient, type MessagesTransport } from './anthropic-messages.js';

export interface AnthropicClientOptions {
  /** API key for BYOK. Falls back to the SDK's own env resolution when omitted. */
  apiKey?: string;
  /** Extra SDK client options (base URL, timeout, retries). */
  clientOptions?: ClientOptions;
  /**
   * A pre-built SDK client, or a transport that replaces the network entirely.
   * The transport seam is how tests and the cassette layer (#9) run this provider
   * without an API key; `client` is for callers who manage their own SDK instance.
   */
  client?: Anthropic;
  transport?: MessagesTransport;
  /**
   * Compose a layer around the transport. The cassette layer is what this
   * exists for: a surface can wrap `record`/`replay` around the real provider
   * without having to construct the SDK itself, which is the only way to keep
   * `@anthropic-ai/sdk` out of the CLI's dependency list.
   */
  wrapTransport?: (inner: MessagesTransport) => MessagesTransport;
}

/**
 * The SDK client is constructed **on first call, not on client creation**.
 *
 * `new Anthropic()` throws when `ANTHROPIC_API_KEY` is unset, and in `replay`
 * mode the inner transport is never reached — so an eager construction would
 * demand a key for a run that is deliberately offline. Laziness here is what
 * makes "no credentials in CI" true rather than aspirational.
 */
function defaultTransport(options: AnthropicClientOptions): MessagesTransport {
  let client: Anthropic | undefined = options.client;
  return (params) => {
    client ??= new Anthropic({
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...options.clientOptions,
    });
    return client.messages.create(params);
  };
}

/**
 * The first-party Anthropic provider. Model ids pass through unchanged — the
 * Handrail canonical ids (`claude-haiku-4-5`, `claude-sonnet-5`) are exactly what
 * the Anthropic API expects.
 */
export function createAnthropicClient(options: AnthropicClientOptions = {}): ModelClient {
  const inner = options.transport ?? defaultTransport(options);
  return createMessagesClient({
    provider: 'anthropic',
    transport: options.wrapTransport?.(inner) ?? inner,
    toWireModel: (model) => model,
  });
}
