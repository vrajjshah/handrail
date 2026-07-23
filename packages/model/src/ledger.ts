import { randomUUID } from 'node:crypto';

import {
  type ModelInvocation,
  ModelInvocationSchema,
  type ScanId,
  type TokenUsage,
  TokenUsageSchema,
} from '@handrail/schemas';
import { type z } from 'zod';

import { computeInputDigest } from './digest.js';
import { toModelError } from './errors.js';
import { resolveModel } from './models.js';
import { computeCostUsd } from './pricing.js';
import {
  type ModelClient,
  type ModelRequest,
  type ModelResult,
  type ResolvedModelRequest,
} from './types.js';

export interface CostLedgerOptions {
  scanId: ScanId;
  /** Threads through logs and events; defaults to the scan id. */
  correlationId?: string;
  /** Clock seam — injected in tests so latency and timestamps are deterministic. */
  now?: () => Date;
  /** Id seam for `ModelInvocation.id` — injected in tests. */
  newId?: () => string;
  /**
   * Called with every recorded invocation, success or failure. The orchestrator
   * uses this to emit a `model.invoked` event; the model package stays below the
   * event-sequencing concern and never mints a `seq`.
   */
  onInvocation?: (invocation: ModelInvocation) => void;
}

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Everything a ledger row needs except the fields the ledger itself owns. */
type LedgerRow = Omit<
  z.input<typeof ModelInvocationSchema>,
  'scanId' | 'correlationId' | 'startedAt'
> & { startedAt: Date };

/**
 * The cost ledger *is* the provider seam. Every model call goes through
 * {@link CostLedger.invoke}, which times it, prices it, and records a schema-valid
 * {@link ModelInvocation} whether it succeeded or failed — that recorded row is
 * the audit trail COST.md is built from and the answer to "what did the model see"
 * when a finding is disputed.
 *
 * Trust invariant 1 lives in the catch block: a provider failure is recorded and
 * then *re-thrown as a typed error*. There is no path that swallows the error and
 * returns a deterministic result as though that were what the caller asked for.
 */
export class CostLedger {
  readonly scanId: ScanId;
  readonly correlationId: string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onInvocation: ((invocation: ModelInvocation) => void) | undefined;
  private readonly rows: ModelInvocation[] = [];

  constructor(options: CostLedgerOptions) {
    this.scanId = options.scanId;
    this.correlationId = options.correlationId ?? String(options.scanId);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `inv_${randomUUID()}`);
    this.onInvocation = options.onInvocation;
  }

  /** Every invocation recorded so far, in call order. */
  get invocations(): readonly ModelInvocation[] {
    return this.rows;
  }

  /** Running dollar total — the sum the per-scan budget is checked against. */
  get totalCostUsd(): number {
    return this.rows.reduce((sum, row) => sum + row.costUsd, 0);
  }

  /** Aggregate token usage across every call, failures contributing zero. */
  get totalUsage(): TokenUsage {
    return this.rows.reduce<TokenUsage>(
      (acc, row) => ({
        input: acc.input + row.usage.input,
        output: acc.output + row.usage.output,
        cacheRead: acc.cacheRead + row.usage.cacheRead,
        cacheWrite: acc.cacheWrite + row.usage.cacheWrite,
      }),
      { ...ZERO_USAGE },
    );
  }

  async invoke<TOutput = string>(
    client: ModelClient,
    request: ModelRequest<TOutput>,
  ): Promise<ModelResult<TOutput>> {
    const model = resolveModel(request);
    const inputDigest = computeInputDigest(request);
    const resolved: ResolvedModelRequest<TOutput> = { ...request, model, inputDigest };
    const startedAt = this.now();
    const id = this.newId();

    try {
      const completion = await client.complete(resolved);
      const latencyMs = this.elapsedSince(startedAt);
      const usage = TokenUsageSchema.parse(completion.usage);
      const costUsd = computeCostUsd({
        provider: client.provider,
        model: completion.model,
        usage,
        at: startedAt,
      });

      const invocation = this.record({
        id,
        role: request.role,
        provider: client.provider,
        model: completion.model,
        promptVersion: request.promptVersion,
        inputDigest,
        usage,
        costUsd,
        latencyMs,
        cached: completion.cached ?? false,
        startedAt,
        ok: true,
      });

      const output = (request.outputSchema ? completion.output : completion.text) as TOutput;
      return { output, text: completion.text, usage, invocation };
    } catch (thrown) {
      const latencyMs = this.elapsedSince(startedAt);
      const error = toModelError(thrown, client.provider);

      this.record({
        id,
        role: request.role,
        provider: client.provider,
        model,
        promptVersion: request.promptVersion,
        inputDigest,
        usage: ZERO_USAGE,
        costUsd: 0,
        latencyMs,
        cached: false,
        startedAt,
        ok: false,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 2000),
      });

      throw error;
    }
  }

  private elapsedSince(startedAt: Date): number {
    return Math.max(0, Math.round(this.now().getTime() - startedAt.getTime()));
  }

  private record(row: LedgerRow): ModelInvocation {
    const invocation = ModelInvocationSchema.parse({
      ...row,
      scanId: this.scanId,
      correlationId: this.correlationId,
      startedAt: row.startedAt.toISOString(),
    });
    this.rows.push(invocation);
    this.onInvocation?.(invocation);
    return invocation;
  }
}
