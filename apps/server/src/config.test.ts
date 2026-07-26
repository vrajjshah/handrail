import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError, ConfigSchema, loadConfig, runsScans, servesHttp } from './config.js';

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

  it('ships no value for the admin token', async () => {
    // Documented, deliberately unset. A default admin token is a published one.
    const text = await readFile(ENV_EXAMPLE, 'utf8');
    const active = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#'));
    expect(active.some((line) => line.startsWith('ADMIN_TOKEN='))).toBe(false);
  });

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
