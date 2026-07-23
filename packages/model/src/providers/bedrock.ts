import { AnthropicBedrockMantle, type BedrockMantleClientOptions } from '@anthropic-ai/bedrock-sdk';

import { type ModelClient } from '../types.js';
import { createMessagesClient, type MessagesTransport } from './anthropic-messages.js';

/** Bedrock exposes the same Anthropic models under `anthropic.`-prefixed ids. */
export const BEDROCK_MODEL_PREFIX = 'anthropic.';

export function toBedrockModelId(canonicalModel: string): string {
  return canonicalModel.startsWith(BEDROCK_MODEL_PREFIX)
    ? canonicalModel
    : `${BEDROCK_MODEL_PREFIX}${canonicalModel}`;
}

export interface BedrockClientOptions {
  /** AWS region for the Mantle endpoint. Required by the SDK for a live call. */
  awsRegion?: string;
  clientOptions?: BedrockMantleClientOptions;
  /** A pre-built Mantle client, or a transport that replaces the network. */
  client?: AnthropicBedrockMantle;
  transport?: MessagesTransport;
}

function defaultTransport(options: BedrockClientOptions): MessagesTransport {
  const client =
    options.client ??
    new AnthropicBedrockMantle({
      ...(options.awsRegion === undefined ? {} : { awsRegion: options.awsRegion }),
      ...options.clientOptions,
    });
  return (params) => client.messages.create(params);
}

/**
 * The Bedrock (Mantle) provider — the enterprise path. Same Messages
 * implementation as the Anthropic provider; the only differences are the
 * transport and the `anthropic.` model-id prefix, which is exactly what the
 * shared provider factory parameterises.
 */
export function createBedrockClient(options: BedrockClientOptions = {}): ModelClient {
  return createMessagesClient({
    provider: 'bedrock',
    transport: options.transport ?? defaultTransport(options),
    toWireModel: toBedrockModelId,
  });
}
