import { z } from 'zod';

import { CostUsdSchema, IsoTimestampSchema, ScanIdSchema } from './primitives.js';

/** Which job a model call is doing. Roles map to model tiers, not the other way round. */
export const ModelRoleSchema = z.enum(['triage', 'text-judge', 'vision-judge', 'verifier', 'fix']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelProviderSchema = z.enum([
  'anthropic',
  'bedrock',
  'openai',
  'local-deterministic',
]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/**
 * Typed failure modes. There is deliberately no `unknown` bucket that lets a
 * provider error be swallowed: a scan that could not call its model is
 * `degraded`, and says so.
 */
export const ModelErrorCodeSchema = z.enum([
  'auth',
  'rate-limit',
  'overloaded',
  'timeout',
  'context-length',
  'content-filter',
  'schema-invalid',
  'budget-exceeded',
  'network',
  'provider-error',
]);
export type ModelErrorCode = z.infer<typeof ModelErrorCodeSchema>;

export const TokenUsageSchema = z.object({
  input: z.int().nonnegative(),
  output: z.int().nonnegative(),
  cacheRead: z.int().nonnegative().default(0),
  cacheWrite: z.int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * One model call, recorded whether it succeeded or not. This is the cost ledger
 * and the audit trail: COST.md is generated from these, and so is the
 * "what did the model actually see" answer when a finding is disputed.
 */
export const ModelInvocationSchema = z.object({
  id: z.string().min(1),
  scanId: ScanIdSchema,
  correlationId: z.string().min(1),
  role: ModelRoleSchema,
  provider: ModelProviderSchema,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  /** sha256 of the rendered input, used as the judgment-cache and cassette key. */
  inputDigest: z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex digest'),
  usage: TokenUsageSchema,
  costUsd: CostUsdSchema,
  latencyMs: z.int().nonnegative(),
  cached: z.boolean().default(false),
  startedAt: IsoTimestampSchema,
  ok: z.boolean(),
  errorCode: ModelErrorCodeSchema.optional(),
  errorMessage: z.string().max(2000).optional(),
});
export type ModelInvocation = z.infer<typeof ModelInvocationSchema>;
