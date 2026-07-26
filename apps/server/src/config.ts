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
});

export type Config = z.infer<typeof ConfigSchema>;

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
