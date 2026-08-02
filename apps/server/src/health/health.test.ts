import { Writable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';
import { loadConfig } from '../config.js';
import { loggerOptions } from '../logging.js';
import { MemoryArtifactReader, MemoryScanStore } from '../store/memory.js';
import { cacheSuccess, runReadiness, type ReadinessCheck } from './checks.js';
import { chromiumCheck, objectStorageCheck } from './probes.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const passing = (name: string, detail = 'fine'): ReadinessCheck => ({
  name,
  run: () => Promise.resolve(detail),
});

const failing = (name: string, message = 'broken'): ReadinessCheck => ({
  name,
  run: () => Promise.reject(new Error(message)),
});

async function server(readiness: ReadinessCheck[]): Promise<FastifyInstance> {
  app = await buildServer({
    config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    store: new MemoryScanStore(),
    artifacts: new MemoryArtifactReader(),
    toolVersion: '9.9.9-test',
    readiness,
  });
  return app;
}

describe('runReadiness', () => {
  it('is ready when every check passes', async () => {
    const result = await runReadiness([passing('postgres'), passing('queue')]);
    expect(result.ready).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(['postgres', 'queue']);
  });

  it('runs every check even after one fails', async () => {
    // "Postgres is down" and "Postgres is down *and* Chromium is missing" are
    // different mornings. Short-circuiting hides the second one.
    const result = await runReadiness([failing('postgres'), failing('chromium')]);
    expect(result.ready).toBe(false);
    expect(result.checks.filter((check) => !check.ok)).toHaveLength(2);
  });

  it('reports why a check failed', async () => {
    const result = await runReadiness([failing('queue', 'connection refused')]);
    expect(result.checks[0]?.detail).toContain('connection refused');
  });

  it('treats a hung dependency as a failed one', async () => {
    // Without this the probe hangs too, and a load balancer cannot tell
    // "unhealthy" from "slow" — so it keeps sending traffic to a dead container.
    const result = await runReadiness([
      { name: 'stuck', timeoutMs: 20, run: () => new Promise<string>(() => undefined) },
    ]);
    expect(result.ready).toBe(false);
    expect(result.checks[0]?.detail).toContain('timed out');
  });

  it('is ready with nothing to check, and says nothing was checked', async () => {
    const result = await runReadiness([]);
    expect(result).toEqual({ ready: true, checks: [] });
  });
});

describe('cacheSuccess', () => {
  it('does not re-run a check inside the window', async () => {
    let runs = 0;
    let clock = 1_000;
    const cached = cacheSuccess(
      { name: 'chromium', run: () => Promise.resolve(`run ${String(++runs)}`) },
      500,
      () => clock,
    );

    expect(await cached.run()).toBe('run 1');
    expect(await cached.run()).toBe('run 1 (cached)');
    expect(runs).toBe(1);

    clock += 501;
    expect(await cached.run()).toBe('run 2');
  });

  it('never caches a failure', async () => {
    // A cached failure keeps reporting red after the problem is fixed. Worse,
    // the symmetrical mistake — caching across a genuine break — keeps
    // reporting green.
    let attempts = 0;
    const cached = cacheSuccess(
      {
        name: 'chromium',
        run: () => {
          attempts += 1;
          return attempts < 3 ? Promise.reject(new Error('no browser')) : Promise.resolve('ok');
        },
      },
      10_000,
    );

    await expect(cached.run()).rejects.toThrow('no browser');
    await expect(cached.run()).rejects.toThrow('no browser');
    expect(await cached.run()).toBe('ok');
  });
});

describe('chromiumCheck', () => {
  it('passes when a browser launches, and closes it again', async () => {
    // A readiness probe that leaks a browser every few seconds is a memory
    // leak with a green tick next to it.
    let closed = false;
    const check = chromiumCheck({
      launch: () =>
        Promise.resolve({
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        }),
    });

    expect(await check.run()).toContain('launched');
    expect(closed).toBe(true);
  });

  it('fails when the browser cannot launch', async () => {
    const check = chromiumCheck({
      launch: () => Promise.reject(new Error("Executable doesn't exist")),
    });
    await expect(check.run()).rejects.toThrow(/Executable/);
  });
});

describe('objectStorageCheck', () => {
  it('names the bucket it reached', async () => {
    const check = objectStorageCheck({ head: () => Promise.resolve(), bucketName: 'shots' });
    expect(await check.run()).toContain('shots');
  });

  it('fails when the bucket cannot be reached', async () => {
    // A deployment that was told where its bucket is and cannot reach it will
    // complete every scan and produce a report with nothing in it. `/readyz`
    // gates the platform healthcheck, which is what keeps that container from
    // being promoted over the one that works.
    const check = objectStorageCheck({
      head: () => Promise.reject(new Error('AccessDenied')),
      bucketName: 'shots',
    });
    await expect(check.run()).rejects.toThrow(/AccessDenied/);
  });

  it('caches a success but never a failure', async () => {
    let heads = 0;
    const check = objectStorageCheck({
      head: () => {
        heads += 1;
        return Promise.resolve();
      },
      bucketName: 'shots',
    });
    await check.run();
    await check.run();
    expect(heads).toBe(1);
  });
});

describe('GET /healthz', () => {
  it('is 200 even when every dependency is broken', async () => {
    // Liveness must not fail for somebody else's outage: a container restarted
    // because Postgres blinked comes back to the same Postgres.
    const instance = await server([failing('postgres'), failing('chromium')]);
    const response = await instance.inject({ url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('ok');
  });
});

describe('GET /readyz', () => {
  it('is 200 when everything a scan needs is working', async () => {
    const instance = await server([passing('postgres'), passing('queue'), passing('chromium')]);
    const response = await instance.inject({ url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ ready: boolean }>().ready).toBe(true);
  });

  // #20's acceptance criterion, exactly.
  it('goes red when Chromium cannot launch, even though the process is alive', async () => {
    const instance = await server([
      passing('postgres'),
      passing('queue'),
      chromiumCheck({ launch: () => Promise.reject(new Error("Executable doesn't exist")) }),
    ]);

    const ready = await instance.inject({ url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    const body = ready.json<{ ready: boolean; checks: { name: string; ok: boolean }[] }>();
    expect(body.ready).toBe(false);
    expect(body.checks.find((check) => check.name === 'chromium')?.ok).toBe(false);
    // The other two still report, so the failure is identifiable at a glance.
    expect(body.checks.find((check) => check.name === 'postgres')?.ok).toBe(true);

    // And the process is emphatically alive.
    expect((await instance.inject({ url: '/healthz' })).statusCode).toBe(200);
  });

  it('is 503 when Postgres is unreachable', async () => {
    const instance = await server([failing('postgres', 'connection refused'), passing('chromium')]);
    const response = await instance.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('connection refused');
  });

  it('is 503 when the queue is unreachable', async () => {
    const instance = await server([passing('postgres'), failing('queue'), passing('chromium')]);
    expect((await instance.inject({ url: '/readyz' })).statusCode).toBe(503);
  });
});

describe('request logging', () => {
  it('puts correlationId on the request lines Fastify writes itself', async () => {
    // Binding it in an `onRequest` hook is too late: "incoming request" is
    // already written, and those are the lines anyone greps for. It has to come
    // from `childLoggerFactory`.
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim().length > 0) lines.push(JSON.parse(line) as Record<string, unknown>);
        }
        callback();
      },
    });

    const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    app = await buildServer({
      config,
      store: new MemoryScanStore(),
      artifacts: new MemoryArtifactReader(),
      toolVersion: '9.9.9-test',
      logger: pino(loggerOptions(config), stream),
    });

    await app.inject({ url: '/api/scans/scan_9f1c' });

    const correlated = lines.filter((line) => line.correlationId === 'scan_9f1c');
    expect(correlated.length).toBeGreaterThanOrEqual(2);
    expect(correlated.map((line) => line.msg)).toContain('incoming request');
    expect(correlated.map((line) => line.msg)).toContain('request completed');

    // And the request line is a real request, not an object stripped to its id.
    const incoming = correlated.find((line) => line.msg === 'incoming request');
    expect(incoming?.req).toMatchObject({ method: 'GET', path: '/api/scans/scan_9f1c' });
  });
});
