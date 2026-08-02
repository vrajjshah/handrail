import { z } from 'zod';

/**
 * The environment contract.
 *
 * `.env.example` is generated from this schema, so the two cannot disagree —
 * an undocumented variable is the most common way a deploy differs from a
 * developer's machine in a way nobody can see.
 *
 * Nothing here has a secret default. A missing credential fails at boot with
 * the variable's name in the message, rather than at the first request that
 * needed it.
 */
export const ConfigSchema = z.object({
  /** `api` serves HTTP, `worker` runs scans, `both` does each in one process. */
  SERVICE_ROLE: z.enum(['api', 'worker', 'both']).default('both'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65_535).default(8080),
  /** How the API refers to itself in generated links and the OpenAPI servers list. */
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Postgres. Optional, and the absence is not a silent downgrade: without it
   * the server holds scans in memory, says so at boot, and `/readyz` reports
   * that it has no database. A hosted deployment sets it.
   */
  DATABASE_URL: z.string().min(1).optional(),

  /**
   * How long a worker may hold a scan job before the queue assumes it died.
   *
   * Must exceed the longest scan the budget permits (10 minutes), or a slow
   * scan is handed to a second worker while the first is still running it.
   */
  JOB_EXPIRE_SECONDS: z.coerce.number().int().positive().default(900),

  /** pg-boss concurrency. 1–2: the constraint is a real browser, not throughput. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),

  /**
   * Bypasses the rate limits, for the demo and for debugging a report.
   *
   * Optional and unset by default: an admin token with a default value is a
   * published credential. A short one is worse than none, so the minimum is
   * long enough that guessing is not the attack.
   */
  ADMIN_TOKEN: z.string().min(32).optional(),

  /**
   * Cloudflare R2, where screenshots live (#22).
   *
   * All four or none: a half-configured object store is the failure where the
   * server boots, scans, and silently takes no screenshots — which is exactly
   * the state this issue exists to end. {@link assertRunnable} enforces it and
   * names the variables that are missing.
   *
   * Without them the server runs, and says so: scans capture no screenshots and
   * the report carries no evidence images. That is a smaller deployment, not a
   * broken one, and it is what a developer's machine looks like.
   */
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/** The four R2 variables, resolved together or not at all. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const R2_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const satisfies readonly (keyof Config)[];

/**
 * The R2 credentials, when the deployment has them.
 *
 * `undefined` for none of them — the local default, and honest: no object
 * store, no screenshots, and the boot log says so. A **partial** set throws,
 * because the alternative is a container that starts perfectly and quietly
 * produces evidence-free reports. That failure is invisible for as long as
 * nobody opens a report, which is far too long.
 */
export function r2ConfigFrom(config: Config): R2Config | undefined {
  const missing = R2_KEYS.filter((key) => config[key] === undefined);
  if (missing.length === R2_KEYS.length) return undefined;
  if (missing.length > 0) {
    throw new ConfigError(
      `R2 is half-configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Set all four (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) ' +
        'or none — a partial set is a deployment that boots and takes no screenshots.',
    );
  }

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = config;
  // Re-checked rather than asserted: `missing` proves it, but a cast here would
  // survive someone adding a fifth variable and forgetting the list.
  if (
    R2_ACCOUNT_ID === undefined ||
    R2_ACCESS_KEY_ID === undefined ||
    R2_SECRET_ACCESS_KEY === undefined ||
    R2_BUCKET === undefined
  ) {
    throw new ConfigError('R2 is half-configured');
  }

  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n  ');
  throw new ConfigError(`the environment is not valid:\n  ${problems}`);
}

/** True when this process should serve HTTP. */
export function servesHttp(config: Config): boolean {
  return config.SERVICE_ROLE !== 'worker';
}

/** True when this process should run scans. */
export function runsScans(config: Config): boolean {
  return config.SERVICE_ROLE !== 'api';
}

/**
 * A worker with no database has nowhere to take jobs from.
 *
 * Checked at boot rather than discovered at the first job, because a container
 * that starts cleanly and then quietly does nothing is the worst of the
 * available failures.
 */
export function assertRunnable(config: Config): void {
  if (runsScans(config) && config.DATABASE_URL === undefined && config.SERVICE_ROLE === 'worker') {
    throw new ConfigError(
      'SERVICE_ROLE=worker needs DATABASE_URL: the job queue lives in Postgres, ' +
        'so a worker without one has no queue to consume.',
    );
  }

  // Throws on a partial set, at boot, naming what is missing.
  r2ConfigFrom(config);
}
