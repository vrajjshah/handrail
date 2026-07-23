import { type ModelProvider } from '@handrail/schemas';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  type ContentBlockParam,
  type MessageCreateParamsNonStreaming,
  type MessageParam,
} from '@anthropic-ai/sdk/resources/messages';

import { capabilityFor, type ModelCapabilities } from '../capability.js';
import { ModelError } from '../errors.js';
import {
  type ContentBlock,
  type ModelClient,
  type ModelCompletion,
  type ModelMessage,
  type RawTokenUsage,
  type ResolvedModelRequest,
} from '../types.js';

/**
 * The default output cap. Judgment calls are small; callers size it per role via
 * `maxOutputTokens`. Kept under the streaming-recommended ceiling so a
 * non-streaming call never risks an SDK HTTP timeout, and — because on Sonnet 5
 * `max_tokens` bounds thinking *and* response together — large enough that an
 * adaptive-thinking call is not truncated mid-answer.
 */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * The read-model of a Messages API response — only the fields the seam consumes.
 * A real SDK `Message` is a structural supertype of this, so the live transport
 * returns one unchanged while a test transport can hand back a tiny literal.
 */
export interface AnthropicMessageResponse {
  model?: string;
  stop_reason?: string | null;
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

/**
 * The one seam a provider is built on: turn create-params into a response. The
 * live transport is `client.messages.create`; tests inject a fake so the whole
 * provider runs offline, which is also what lets CI stay network-free until the
 * cassette layer (#9) records real responses.
 */
export type MessagesTransport = (
  params: MessageCreateParamsNonStreaming,
) => Promise<AnthropicMessageResponse>;

export interface MessagesClientConfig {
  provider: ModelProvider;
  transport: MessagesTransport;
  /** Map a canonical Handrail model id to the id this provider's wire expects. */
  toWireModel: (canonicalModel: string) => string;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function toContentBlockParam(block: ContentBlock): ContentBlockParam {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      // The SDK accepts only these four media types; a caller that supplies
      // another has a bug upstream — the value is passed through as-is.
      media_type: block.mediaType as ImageMediaType,
      data: block.dataBase64,
    },
  };
}

function toMessageParam(message: ModelMessage): MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return { role: message.role, content: message.content.map(toContentBlockParam) };
}

/**
 * Build the create-params, honouring the ADR-0004 constraints as data from the
 * capability map rather than model-string sniffing: the thinking mode is set
 * explicitly (adaptive where the model runs it, omitted otherwise, never relying
 * on the silent default), and no sampling knob is ever emitted — Sonnet 5 rejects
 * them, so the seam simply has none. The `system` prefix carries a cache
 * breakpoint so a repeated prefix bills as a cache read on the next call.
 */
export function buildCreateParams(
  request: ResolvedModelRequest,
  capabilities: ModelCapabilities,
  wireModel: string,
): MessageCreateParamsNonStreaming {
  return {
    model: wireModel,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages: request.messages.map(toMessageParam),
    ...(request.system !== undefined
      ? {
          system: [
            { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
          ],
        }
      : {}),
    ...(capabilities.defaultThinking === 'adaptive'
      ? { thinking: { type: 'adaptive', display: 'omitted' } }
      : {}),
    ...(request.outputSchema
      ? { output_config: { format: zodOutputFormat(request.outputSchema) } }
      : {}),
  };
}

function extractText(content: AnthropicMessageResponse['content']): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
}

function parseStructured(text: string, schema: NonNullable<ResolvedModelRequest['outputSchema']>, provider: ModelProvider): unknown {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ModelError('schema-invalid', 'model output was not valid JSON', { provider });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ModelError('schema-invalid', parsed.error.message, { provider });
  }
  return parsed.data;
}

/**
 * Map a successful response to a `ModelCompletion`. A `refusal` stop reason is a
 * successful HTTP 200 but a real failure to answer, so it becomes a typed
 * `content-filter` error rather than being mistaken for output. The reported
 * model is the canonical id (not the provider's wire id), so cost and capability
 * lookups stay provider-agnostic.
 */
export function mapCompletion(
  request: ResolvedModelRequest,
  response: AnthropicMessageResponse,
  provider: ModelProvider,
): ModelCompletion {
  if (response.stop_reason === 'refusal') {
    throw new ModelError('content-filter', 'the model declined to respond (refusal)', { provider });
  }

  const text = extractText(response.content);
  const usage: RawTokenUsage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  const cached = (usage.cacheRead ?? 0) > 0;

  if (request.outputSchema) {
    return {
      model: request.model,
      output: parseStructured(text, request.outputSchema, provider),
      text,
      usage,
      cached,
    };
  }
  return { model: request.model, output: text, text, usage, cached };
}

function readStatus(error: unknown): number | undefined {
  if (error instanceof APIError && typeof error.status === 'number') return error.status;
  return undefined;
}

/**
 * Normalise a provider failure into a typed `ModelError`, using the SDK's own
 * error classes and HTTP status — no message string-matching. An already-typed
 * `ModelError` (e.g. the `schema-invalid` thrown while mapping) passes through.
 */
export function mapProviderError(error: unknown, provider: ModelProvider): ModelError {
  if (error instanceof ModelError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const options = { provider, cause: error } as const;

  if (error instanceof APIConnectionTimeoutError) return new ModelError('timeout', message, options);
  if (error instanceof APIConnectionError) return new ModelError('network', message, options);

  const status = readStatus(error);
  if (status === 401 || status === 403) return new ModelError('auth', message, options);
  if (status === 408) return new ModelError('timeout', message, options);
  if (status === 413) return new ModelError('context-length', message, options);
  if (status === 429) return new ModelError('rate-limit', message, options);
  if (status === 529) return new ModelError('overloaded', message, options);
  if (status !== undefined && status >= 500) return new ModelError('provider-error', message, options);

  return new ModelError('provider-error', message, options);
}

/**
 * Build a `ModelClient` over a Messages transport. Both the Anthropic and Bedrock
 * providers are this same implementation with a different transport and model-id
 * mapping — the only things that actually differ between them.
 */
export function createMessagesClient(config: MessagesClientConfig): ModelClient {
  return {
    provider: config.provider,
    async complete(request: ResolvedModelRequest): Promise<ModelCompletion> {
      const capabilities = capabilityFor(config.provider, request.model);
      const params = buildCreateParams(request, capabilities, config.toWireModel(request.model));

      let response: AnthropicMessageResponse;
      try {
        response = await config.transport(params);
      } catch (error) {
        throw mapProviderError(error, config.provider);
      }
      return mapCompletion(request, response, config.provider);
    },
  };
}
