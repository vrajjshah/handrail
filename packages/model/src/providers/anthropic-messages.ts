import { type ModelProvider, type ModelRole } from '@handrail/schemas';
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
  type Tool,
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
  content: { type: string; text?: string; name?: string; input?: unknown }[];
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
/**
 * The provenance of a call, travelling alongside the wire params. The cassette
 * layer keys on `(role, promptVersion, inputDigest)`, and none of those survive
 * into `MessageCreateParamsNonStreaming` — so the transport carries them
 * explicitly rather than trying to reconstruct them from the params.
 */
export interface TransportContext {
  provider: ModelProvider;
  role: ModelRole;
  promptVersion: string;
  /** The canonical (unprefixed) model id. */
  model: string;
  inputDigest: string;
}

export type MessagesTransport = (
  params: MessageCreateParamsNonStreaming,
  context: TransportContext,
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
 * The tool a provider without native structured outputs is forced to call.
 *
 * Its `input` *is* the structured result — a forced single-tool call is the
 * portable way to make a model emit schema-shaped JSON, and it is what the
 * capability map's `forcedToolChoiceRequiresThinkingDisabled` flag was always
 * pointing at.
 */
export const STRUCTURED_OUTPUT_TOOL = 'emit_structured_result';

/**
 * Build the create-params, honouring the ADR-0004 constraints as data from the
 * capability map rather than model-string sniffing: the thinking mode is set
 * explicitly (adaptive where the model runs it, omitted otherwise, never relying
 * on the silent default), and no sampling knob is ever emitted — Sonnet 5 rejects
 * them, so the seam simply has none. The `system` prefix carries a cache
 * breakpoint so a repeated prefix bills as a cache read on the next call.
 *
 * Structured output takes one of two routes, chosen by capability:
 *
 * - **`output_config.format`** where the provider has native structured outputs.
 * - **a forced tool call** where it does not. Bedrock rejects `output_config`
 *   outright (`Extra inputs are not permitted`), so the schema is offered as a
 *   single tool the model is forced to call, and its `input` is the result.
 *   Bedrock additionally refuses a forced `tool_choice` while thinking is on,
 *   which is why the mode is disabled explicitly rather than left to default.
 */
export function buildCreateParams(
  request: ResolvedModelRequest,
  capabilities: ModelCapabilities,
  wireModel: string,
): MessageCreateParamsNonStreaming {
  const params: MessageCreateParamsNonStreaming = {
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
  };

  const schema = request.outputSchema;
  if (schema === undefined) return params;

  if (capabilities.supportsStructuredOutput) {
    return { ...params, output_config: { format: zodOutputFormat(schema) } };
  }

  return {
    ...params,
    tools: [
      {
        name: STRUCTURED_OUTPUT_TOOL,
        description: 'Return the result. Call this exactly once, with the full result.',
        input_schema: zodOutputFormat(schema).schema as Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: STRUCTURED_OUTPUT_TOOL },
    ...(capabilities.forcedToolChoiceRequiresThinkingDisabled
      ? { thinking: { type: 'disabled' as const } }
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
    // On the forced-tool route the result arrives already decoded as the tool's
    // `input`, so there is nothing to JSON.parse — but it is still validated
    // against the same schema, because "the model called the tool" is not the
    // same claim as "the model filled it in correctly".
    const toolCall = response.content.find(
      (block) => block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL,
    );
    if (toolCall !== undefined) {
      const parsed = request.outputSchema.safeParse(toolCall.input);
      if (!parsed.success) {
        throw new ModelError('schema-invalid', parsed.error.message, { provider });
      }
      return { model: request.model, output: parsed.data, text, usage, cached };
    }

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
        response = await config.transport(params, {
          provider: config.provider,
          role: request.role,
          promptVersion: request.promptVersion,
          model: request.model,
          inputDigest: request.inputDigest,
        });
      } catch (error) {
        throw mapProviderError(error, config.provider);
      }
      return mapCompletion(request, response, config.provider);
    },
  };
}
