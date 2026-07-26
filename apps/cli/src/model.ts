import {
  CostLedger,
  FileCassetteStore,
  ModelError,
  createAnthropicClient,
  createBedrockClient,
  resolveModelMode,
  withCassettes,
  type MessagesTransport,
  type ModelClient,
  type ModelMode,
} from '@handrail/model';
import type { ModelInvocation, ScanId, ScanMode } from '@handrail/schemas';

import { UsageError } from './args.js';

export interface ModelDeps {
  ledger: CostLedger;
  client: ModelClient;
  verifierClient?: ModelClient;
}

export interface ModelSetup {
  /** Absent in deterministic mode. Absent means *nothing was constructed*. */
  model?: ModelDeps;
  /** Lines the CLI prints so the user knows exactly what will be called. */
  notes: string[];
}

export interface ModelSetupOptions {
  mode: ScanMode;
  scanId: ScanId;
  /** Hard spend cap. The scan degrades at the ceiling rather than overrunning it. */
  budgetUsd?: number | undefined;
  env?: Record<string, string | undefined>;
  onInvocation?: (invocation: ModelInvocation) => void;
  /** Test seam. The real implementation reaches a provider SDK; nothing in a test should. */
  createClient?: (options: CreateClientOptions) => ModelClient;
}

export interface CreateClientOptions {
  provider: 'anthropic' | 'bedrock';
  cassetteMode: ModelMode;
  cassetteDir: string;
  apiKey?: string | undefined;
  awsRegion?: string | undefined;
}

/**
 * Wrap a client so the ledger's running total is checked *before* each call.
 *
 * Checking after the fact would report the overrun and still have spent the
 * money. The throw is a typed `budget-exceeded`, so the graph records it as a
 * degradation and the report says the scan stopped early — which is the whole
 * point of having a budget rather than a hope.
 */
export function withBudget(client: ModelClient, ledger: CostLedger, budgetUsd: number): ModelClient {
  return {
    provider: client.provider,
    complete(request) {
      if (ledger.totalCostUsd >= budgetUsd) {
        return Promise.reject(
          new ModelError(
            'budget-exceeded',
            `scan budget of $${budgetUsd.toFixed(2)} reached after $${ledger.totalCostUsd.toFixed(4)}; ` +
              'no further model calls will be made',
          ),
        );
      }
      return client.complete(request);
    },
  };
}

function defaultCreateClient(options: CreateClientOptions): ModelClient {
  const store = new FileCassetteStore(options.cassetteDir);
  const wrapTransport =
    options.cassetteMode === 'live'
      ? undefined
      : (inner: MessagesTransport) => withCassettes(inner, { mode: options.cassetteMode, store });

  return options.provider === 'bedrock'
    ? createBedrockClient({
        ...(options.awsRegion === undefined ? {} : { awsRegion: options.awsRegion }),
        ...(wrapTransport === undefined ? {} : { wrapTransport }),
      })
    : createAnthropicClient({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(wrapTransport === undefined ? {} : { wrapTransport }),
      });
}

/**
 * Decide what, if anything, this scan may call.
 *
 * **`deterministic` returns `{}` — no client, no ledger, no SDK constructed.**
 * That is the acceptance criterion stated as code: the mode cannot cost money or
 * reach a network because there is nothing in the graph capable of it, not
 * because a flag is checked somewhere downstream. There is a test that asserts
 * the factory is never even called.
 *
 * The other half of the contract is that a hybrid scan which *cannot* reach its
 * model fails loudly. Missing credentials are a usage error here, before the
 * browser opens — not a silent downgrade to deterministic results the user did
 * not ask for.
 */
export function createModelSetup(options: ModelSetupOptions): ModelSetup {
  if (options.mode === 'deterministic') {
    return { notes: ['deterministic mode: no model client is constructed, and the scan costs $0'] };
  }

  const env = options.env ?? process.env;
  const cassetteMode = resolveModelMode(env);
  const provider = env.HANDRAIL_PROVIDER === 'bedrock' ? 'bedrock' : 'anthropic';
  const notes: string[] = [];

  if (cassetteMode === 'live' && provider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new UsageError(
      'hybrid mode needs ANTHROPIC_API_KEY (or HANDRAIL_PROVIDER=bedrock with AWS credentials, ' +
        'or MODEL_MODE=replay against a recorded cassette corpus). ' +
        'Run with --mode deterministic to scan offline at $0.',
    );
  }

  const ledger = new CostLedger({
    scanId: options.scanId,
    ...(options.onInvocation === undefined ? {} : { onInvocation: options.onInvocation }),
  });

  const create = options.createClient ?? defaultCreateClient;
  const clientOptions: CreateClientOptions = {
    provider,
    cassetteMode,
    cassetteDir: env.HANDRAIL_CASSETTE_DIR ?? 'cassettes',
    apiKey: env.ANTHROPIC_API_KEY,
    awsRegion: env.AWS_REGION,
  };

  const client = create(clientOptions);
  // A separate client instance for the verifier. Independence is structural in
  // the engine (its own prompt, rendered from the snapshot rather than from the
  // judge's answer); giving it its own client keeps the seam honest here too.
  const verifierClient = create(clientOptions);

  notes.push(`${options.mode} mode: ${provider} provider, MODEL_MODE=${cassetteMode}`);
  if (options.mode === 'hybrid-vision') {
    notes.push('vision judgment is not implemented yet (Phase 3); this scan runs the text layer only');
  }

  const budgeted =
    options.budgetUsd === undefined
      ? { client, verifierClient }
      : {
          client: withBudget(client, ledger, options.budgetUsd),
          verifierClient: withBudget(verifierClient, ledger, options.budgetUsd),
        };
  if (options.budgetUsd !== undefined) {
    notes.push(`budget: $${options.budgetUsd.toFixed(2)} — the scan degrades at the ceiling`);
  }

  return { model: { ledger, ...budgeted }, notes };
}
