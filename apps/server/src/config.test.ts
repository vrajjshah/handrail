import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  ConfigSchema,
  assertRunnable,
  loadConfig,
  r2ConfigFrom,
  runsScans,
  servesHttp,
} from './config.js';

const R2_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'handrail-artifacts',
};

const ENV_EXAMPLE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.env.example',
);

describe('loadConfig', () => {
  it('runs with nothing set, in the safest configuration', () => {
    const config = loadConfig({});
    expect(config.SERVICE_ROLE).toBe('both');
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
  });

  it('coerces PORT, because an environment variable is always a string', () => {
    expect(loadConfig({ PORT: '3000' }).PORT).toBe(3000);
  });

  it('names the variable when it rejects one', () => {
    // A boot failure that does not say which variable is wrong costs an hour.
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ SERVICE_ROLE: 'api-ish' })).toThrow(/SERVICE_ROLE/);
    expect(() => loadConfig({ PUBLIC_URL: 'not-a-url' })).toThrow(/PUBLIC_URL/);
  });

  it('ignores the rest of the environment', () => {
    expect(() => loadConfig({ PATH: '/usr/bin', HOME: '/root' })).not.toThrow();
  });
});

describe('service roles', () => {
  it.each([
    ['api', true, false],
    ['worker', false, true],
    ['both', true, true],
  ] as const)('%s serves=%s runs=%s', (role, http, scans) => {
    const config = loadConfig({ SERVICE_ROLE: role });
    expect(servesHttp(config)).toBe(http);
    expect(runsScans(config)).toBe(scans);
  });
});

describe('R2 credentials', () => {
  it('is a valid deployment with none of them set', () => {
    // No object store means no screenshots, and the boot log plus `/readyz`
    // both say so. That is a smaller deployment, not a broken one.
    expect(r2ConfigFrom(loadConfig({}))).toBeUndefined();
    expect(() => assertRunnable(loadConfig({}))).not.toThrow();
  });

  it('resolves all four together', () => {
    expect(r2ConfigFrom(loadConfig(R2_ENV))).toEqual({
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'handrail-artifacts',
    });
  });

  it.each(Object.keys(R2_ENV))('fails at boot when %s alone is missing', (key) => {
    // The failure this prevents is invisible: a container that starts
    // perfectly, scans happily, and produces reports with no evidence in them
    // for as long as nobody opens one.
    const partial = { ...R2_ENV } as Record<string, string>;
    delete partial[key];
    const config = loadConfig(partial);

    expect(() => r2ConfigFrom(config)).toThrow(ConfigError);
    expect(() => r2ConfigFrom(config)).toThrow(new RegExp(key));
    expect(() => assertRunnable(config)).toThrow(ConfigError);
  });
});

describe('.env.example', () => {
  it('documents every variable the schema reads', async () => {
    // The contract, enforced. A variable the schema knows about and the example
    // does not is exactly how a deploy comes to depend on something nobody has
    // written down.
    //
    // A *commented* assignment counts as documented. That is how a secret is
    // written down without shipping a value for it — an `ADMIN_TOKEN` with a
    // default in the example file is a published credential.
    const text = await readFile(ENV_EXAMPLE, 'utf8');
    const documented = new Set(
      text
        .split('\n')
        .map((line) => line.trim().replace(/^#\s*/, ''))
        .filter((line) => line.includes('='))
        .map((line) => line.split('=')[0]?.trim() ?? ''),
    );

    for (const key of Object.keys(ConfigSchema.shape)) {
      expect(documented, `.env.example is missing ${key}`).toContain(key);
    }
  });

  it.each(['ADMIN_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])(
    'ships no value for %s',
    async (key) => {
      // Documented, deliberately unset. A credential with a value in a
      // committed example file is a published credential.
      const text = await readFile(ENV_EXAMPLE, 'utf8');
      const active = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#'));
      expect(active.some((line) => line.startsWith(`${key}=`))).toBe(false);
    },
  );

  it('is itself a valid environment', async () => {
    const text = await readFile(ENV_EXAMPLE, 'utf8');
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
    expect(() => loadConfig(env)).not.toThrow();
  });
});
