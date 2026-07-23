import { type ModelProvider, ModelProviderSchema, type ModelRole, ModelRoleSchema } from '@handrail/schemas';
import { type MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';

import { type AnthropicMessageResponse } from '../providers/anthropic-messages.js';

/**
 * What makes one recorded interaction distinct. Deliberately *not* the model id:
 * the same rendered prompt at the same version should replay whether it was
 * recorded against Anthropic or Bedrock, so a provider swap does not silently
 * invalidate the whole corpus.
 */
export interface CassetteKey {
  role: ModelRole;
  promptVersion: string;
  inputDigest: string;
}

/** The key plus the provenance of the recording, kept for the audit trail. */
export interface CassetteIdentity extends CassetteKey {
  provider: ModelProvider;
  model: string;
}

/**
 * One recorded interaction. The *request* is stored alongside the response so
 * `cassettes:refresh` can re-issue exactly what was sent — that is what makes a
 * refresh a true re-record rather than a guess — and so a disputed finding can be
 * traced back to what the model actually saw.
 */
export interface Cassette {
  version: 1;
  key: CassetteIdentity;
  recordedAt: string;
  request: MessageCreateParamsNonStreaming;
  response: AnthropicMessageResponse;
}

export interface CassetteStore {
  read(key: CassetteKey): Promise<Cassette | undefined>;
  write(cassette: Cassette): Promise<void>;
  list(): Promise<Cassette[]>;
}

/**
 * Validated on read. Cassettes are committed files that humans occasionally
 * hand-edit and merge, so a truncated or malformed one should fail with a clear
 * message here rather than as a confusing parse error deep in the response mapper.
 */
export const CassetteFileSchema = z.object({
  version: z.literal(1),
  key: z.object({
    role: ModelRoleSchema,
    promptVersion: z.string().min(1),
    inputDigest: z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex digest'),
    provider: ModelProviderSchema,
    model: z.string().min(1),
  }),
  recordedAt: z.string().min(1),
  request: z.looseObject({ model: z.string().min(1) }),
  response: z.looseObject({
    content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
    usage: z.looseObject({
      input_tokens: z.int().nonnegative(),
      output_tokens: z.int().nonnegative(),
    }),
  }),
});
