import {
  type ModelInvocation,
  type ModelProvider,
  type ModelRole,
  type TokenUsage,
} from '@handrail/schemas';
import { type z } from 'zod';

/** A single image reaching a vision-capable model. Base64 keeps the seam transport-agnostic. */
export interface ImageContentBlock {
  type: 'image';
  /** e.g. `image/png`. */
  mediaType: string;
  /** Base64-encoded bytes, no data-URI prefix. */
  dataBase64: string;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/**
 * A provider-agnostic request. Note the deliberate absence of a `temperature`
 * knob: Sonnet 5 rejects non-default sampling params (ADR-0004), so steering is
 * by prompt only across the whole seam. `system` is the stable, cacheable prefix
 * — keeping it separate from `messages` is what lets a later cache layer key on it.
 */
export interface ModelRequest<TOutput = string> {
  role: ModelRole;
  /** Bumped when the rendered prompt changes; recorded on every invocation. */
  promptVersion: string;
  /**
   * The concrete model id. Optional at the call site: when omitted it is resolved
   * from the role via {@link DEFAULT_ROLE_MODELS}.
   */
  model?: string;
  /** The cacheable prefix — system prompt plus any stable reference material. */
  system?: string;
  messages: ModelMessage[];
  /**
   * When present, the provider must return output that parses against this schema
   * (native structured outputs upstream). Absent means a plain-text completion.
   */
  outputSchema?: z.ZodType<TOutput>;
  /** Caps thinking *and* response together on adaptive-thinking models — size against that. */
  maxOutputTokens?: number;
}

/** A request with its model resolved and its input digest computed, ready for a provider. */
export interface ResolvedModelRequest<TOutput = unknown> extends ModelRequest<TOutput> {
  model: string;
  /** sha256 of the rendered input; the judgment-cache and cassette key. */
  inputDigest: string;
}

/**
 * Token counts as a provider reports them — cache fields optional, defaulted to 0
 * downstream. Mirrors the *input* shape of `TokenUsageSchema`; the ledger parses
 * it through that schema before recording, which is where the defaults are applied.
 */
export interface RawTokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** What a provider returns from a successful call. */
export interface ModelCompletion {
  /** The model that actually served the call (Bedrock ids differ from Anthropic ids). */
  model: string;
  /** Structured output when the request carried a schema; otherwise undefined. */
  output: unknown;
  /** The text of the completion, when there is one. */
  text: string | undefined;
  usage: RawTokenUsage;
  /** True when the provider served this from its own prompt cache. */
  cached?: boolean;
}

/**
 * The seam. Every backend — `local-deterministic` today, Anthropic and Bedrock in
 * #8 — implements exactly this. Failures are thrown as {@link ModelError}; there
 * is no success/failure union that could be mistaken for a result.
 */
export interface ModelClient {
  readonly provider: ModelProvider;
  complete(request: ResolvedModelRequest): Promise<ModelCompletion>;
}

/** The outcome of one successful `CostLedger.invoke`: the parsed output plus its ledger row. */
export interface ModelResult<TOutput> {
  output: TOutput;
  text: string | undefined;
  usage: TokenUsage;
  invocation: ModelInvocation;
}
