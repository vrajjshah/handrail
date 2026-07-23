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
}

function defaultTransport(options: AnthropicClientOptions): MessagesTransport {
  const client =
    options.client ??
    new Anthropic({
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...options.clientOptions,
    });
  return (params) => client.messages.create(params);
}

/**
 * The first-party Anthropic provider. Model ids pass through unchanged — the
 * Handrail canonical ids (`claude-haiku-4-5`, `claude-sonnet-5`) are exactly what
 * the Anthropic API expects.
 */
export function createAnthropicClient(options: AnthropicClientOptions = {}): ModelClient {
  return createMessagesClient({
    provider: 'anthropic',
    transport: options.transport ?? defaultTransport(options),
    toWireModel: (model) => model,
  });
}
