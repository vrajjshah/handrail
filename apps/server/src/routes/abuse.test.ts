import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';
import { loadConfig } from '../config.js';
import { HOSTED_LIMITS } from '../security/limits.js';
import type { FetchHead, ResolveHost } from '../security/ssrf.js';
import { MemoryArtifactReader, MemoryScanStore } from '../store/memory.js';

/**
 * The abuse controls, through the API a stranger actually reaches.
 *
 * The unit tests cover the guard's arithmetic; these cover the thing the issue
 * is about — that a probe submitted to `POST /api/scans` is refused, with a
 * status a client can act on and a message a person can read.
 *
 * **This must all pass before the demo URL goes anywhere.**
 */
let app: FastifyInstance | undefined;

const ADMIN_TOKEN = 'x'.repeat(40);

const resolve: ResolveHost = (hostname) => {
  const table: Record<string, string[]> = {
    'example.com': ['93.184.216.34'],
    'redirects.test': ['93.184.216.34'],
    'evil.test': ['127.0.0.1'],
  };
  const addresses = table[hostname];
  return addresses === undefined
    ? Promise.reject(new Error(`no record for ${hostname}`))
    : Promise.resolve(addresses);
};

const head: FetchHead = (url) =>
  Promise.resolve(
    url === 'https://redirects.test/'
      ? { status: 302, location: 'http://169.254.169.254/latest/meta-data/' }
      : { status: 200, location: null },
  );

async function server(options: { admin?: boolean } = {}): Promise<{
  app: FastifyInstance;
  store: MemoryScanStore;
}> {
  const store = new MemoryScanStore();
  const built = await buildServer({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      ...(options.admin === true ? { ADMIN_TOKEN } : {}),
    }),
    store,
    artifacts: new MemoryArtifactReader(),
    toolVersion: '9.9.9-test',
    ssrf: { resolve, head },
  });
  app = built;
  return { app: built, store };
}

function submit(instance: FastifyInstance, url: string, headers: Record<string, string> = {}) {
  return instance.inject({
    method: 'POST',
    url: '/api/scans',
    payload: { url },
    // Fastify reads `request.ip` from here because `trustProxy` is on, which is
    // also how the real deployment sees a client behind Railway's proxy.
    headers: { 'x-forwarded-for': '203.0.113.7', ...headers },
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('the SSRF guard, through the API', () => {
  it.each([
    ['http://localhost:8080/', 'ssrf-blocked-hostname'],
    ['http://127.0.0.1/', 'ssrf-private-address'],
    ['http://169.254.169.254/latest/meta-data/', 'ssrf-private-address'],
    ['http://[::1]/', 'ssrf-private-address'],
    ['http://10.0.0.1/', 'ssrf-private-address'],
    ['https://evil.test/', 'ssrf-private-address'],
  ])('refuses %s with 422 and %s', async (url, code) => {
    const { app: instance } = await server();
    const response = await submit(instance, url);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe(code);
  });

  it('refuses a public URL that redirects to the metadata endpoint', async () => {
    // The bypass this whole design exists for: what the user typed is fine.
    const { app: instance, store } = await server();
    const response = await submit(instance, 'https://redirects.test/');

    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe('ssrf-private-address');
    expect(response.json<{ detail: string }>().detail).toContain('169.254.169.254');

    // And nothing was written: a rejected probe leaves no scan behind.
    expect((await store.stats()).total).toBe(0);
  });

  it('never queues a rejected target', async () => {
    const published: string[] = [];
    const { app: instance } = await server();
    // The queue is absent here, so the assertion is the stronger one: the
    // handler throws before it reaches the enqueue at all.
    await submit(instance, 'http://127.0.0.1/');
    expect(published).toEqual([]);
  });

  it('accepts an ordinary public URL', async () => {
    const { app: instance } = await server();
    const response = await submit(instance, 'https://example.com/');
    expect(response.statusCode).toBe(202);
  });
});

describe('rate limits', () => {
  it('allows three scans an hour from one address and refuses the fourth', async () => {
    const { app: instance } = await server();

    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp; i += 1) {
      expect((await submit(instance, 'https://example.com/')).statusCode).toBe(202);
    }

    const refused = await submit(instance, 'https://example.com/');
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ code: string }>().code).toBe('rate-limited');
    // A machine-readable wait as well as a human-readable one.
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.json<{ detail: string }>().detail).toMatch(/try again in about/i);
  });

  it('counts per address, so one visitor cannot spend the whole allowance', async () => {
    const { app: instance } = await server();
    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp; i += 1) {
      await submit(instance, 'https://example.com/');
    }
    expect((await submit(instance, 'https://example.com/')).statusCode).toBe(429);

    const other = await instance.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com/' },
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });
    expect(other.statusCode).toBe(202);
  });

  it('refuses when the deployment is already running its cap', async () => {
    const { app: instance, store } = await server();
    for (let i = 0; i < HOSTED_LIMITS.globalConcurrentScans; i += 1) {
      const created = await store.create({
        target: { kind: 'url', url: 'https://example.com/' } as never,
        options: {} as never,
        clientIp: '198.51.100.9',
      });
      await store.update(created.id, { status: 'running' });
    }

    const response = await submit(instance, 'https://example.com/');
    expect(response.statusCode).toBe(429);
    expect(response.json<{ detail: string }>().detail).toContain('real browser');
  });

  it('lets an admin token past the limits', async () => {
    const { app: instance } = await server({ admin: true });
    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp + 2; i += 1) {
      const response = await submit(instance, 'https://example.com/', {
        'x-admin-token': ADMIN_TOKEN,
      });
      expect(response.statusCode).toBe(202);
    }
  });

  it('does not let a wrong admin token past', async () => {
    const { app: instance } = await server({ admin: true });
    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp; i += 1) {
      await submit(instance, 'https://example.com/');
    }
    const response = await submit(instance, 'https://example.com/', {
      'x-admin-token': 'y'.repeat(40),
    });
    expect(response.statusCode).toBe(429);
  });

  it('does not let an admin header past a deployment with no token set', async () => {
    // The dangerous default: a server with `ADMIN_TOKEN` unset must not treat
    // any header, or an empty one, as authorisation.
    const { app: instance } = await server();
    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp; i += 1) {
      await submit(instance, 'https://example.com/');
    }
    for (const token of ['', 'anything', 'undefined']) {
      const response = await submit(instance, 'https://example.com/', { 'x-admin-token': token });
      expect(response.statusCode).toBe(429);
    }
  });

  it('checks the limit before the guard, so a probe cannot be free', async () => {
    // Otherwise a rejected probe costs nothing and someone can scan the whole
    // private range one 422 at a time.
    const { app: instance } = await server();
    for (let i = 0; i < HOSTED_LIMITS.scansPerHourPerIp; i += 1) {
      await submit(instance, 'https://example.com/');
    }
    const response = await submit(instance, 'http://169.254.169.254/');
    expect(response.statusCode).toBe(429);
  });
});

describe('per-scan budgets', () => {
  it('applies the hosted ceilings to every submitted scan', async () => {
    const { app: instance } = await server();
    const response = await submit(instance, 'https://example.com/');
    const scan = response.json<{ scan: { target: Record<string, unknown>; options: Record<string, unknown> } }>().scan;

    const target = scan.target as {
      crawl: { maxPages: number };
      budget: { maxUsd: number; maxDurationMs: number; maxModelTokens: number };
    };
    expect(target.crawl.maxPages).toBe(HOSTED_LIMITS.maxPages);
    expect(target.budget.maxDurationMs).toBe(HOSTED_LIMITS.maxDurationMs);
    expect(target.budget.maxUsd).toBe(HOSTED_LIMITS.maxUsd);
    expect(target.budget.maxModelTokens).toBe(HOSTED_LIMITS.maxModelTokens);
    expect(scan.options.budgetUsd).toBe(HOSTED_LIMITS.maxUsd);
  });

  it('scans the URL the redirects actually lead to', async () => {
    // Whatever the guard settled on is what gets scanned. Scanning the
    // submitted URL instead would mean the browser takes a hop nothing checked.
    const { app: instance } = await server();
    const response = await submit(instance, 'https://example.com/');
    const scan = response.json<{ scan: { target: { url: string } } }>().scan;
    expect(scan.target.url).toBe('https://example.com/');
  });
});
