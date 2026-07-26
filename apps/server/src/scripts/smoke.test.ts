import { ReportSchema, ScanRecordSchema } from '@handrail/schemas';
import { buildReport } from '@handrail/engine';
import { describe, expect, it } from 'vitest';

import {
  SmokeFailure,
  assertReport,
  runSmoke,
  scanSelf,
  waitForReady,
  type SmokeOptions,
} from './smoke.js';

/**
 * The acceptance criterion for #21 is that **the smoke gate fails a
 * deliberately broken deploy** — so the interesting tests here are the broken
 * ones. Each names a way a real deploy goes wrong: the container never becomes
 * ready, the worker never picks the job up, the scan fails, or it "completes"
 * having measured nothing because the browser is missing.
 */
const record = (overrides: Record<string, unknown> = {}) =>
  ScanRecordSchema.parse({
    id: 'scan_smoke',
    target: { kind: 'url', url: 'https://handrail.example/' },
    options: { mode: 'deterministic' },
    status: 'queued',
    phase: 'queued',
    createdAt: '2026-07-26T10:00:00.000Z',
    ...overrides,
  });

function report(evaluated: 'full' | 'empty') {
  const scan = record({ status: 'completed', phase: 'report' });
  const built = ReportSchema.parse(
    buildReport({
      scan,
      findings: [],
      // A real scan evaluates *something*. A report built with no check runs
      // at all lands every criterion in `not-tested`, which is precisely the
      // shape the "measured nothing" assertion rejects — so the healthy
      // fixture has to have actually checked something.
      checkRuns: [{ checkId: 'kbd.walk', sc: ['2.4.3'], candidatesChecked: 9 }],
      toolVersion: '9.9.9-test',
      generatedAt: new Date('2026-07-26T10:00:20.000Z'),
    }),
  );
  if (evaluated === 'full') return built;
  // What a deployment with no working browser produces: it completes, and it
  // has measured nothing at all.
  return {
    ...built,
    coverage: {
      ...built.coverage,
      evaluated: 0,
      passVerified: 0,
      failed: 0,
      needsReview: 0,
      notApplicable: 0,
      notTested: built.coverage.criteriaTotal,
    },
  };
}

interface Route {
  status: number;
  body?: unknown;
  text?: string;
}

/** A deployment, faked at the HTTP boundary. */
function deployment(routes: (url: string, call: number) => Route): SmokeOptions {
  const calls = new Map<string, number>();
  let clock = 0;

  return {
    baseUrl: 'https://handrail.example',
    readyTimeoutMs: 10_000,
    scanTimeoutMs: 10_000,
    now: () => clock,
    // The clock only moves when the smoke waits, so a timeout test finishes
    // instantly instead of actually waiting three minutes.
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    fetchImpl: ((input: string | URL) => {
      // `string | URL`, not `RequestInfo`: `String(new Request(...))` would
      // stringify to `[object Request]`, and the routing table is keyed by URL.
      // The smoke only ever passes a string, so narrowing here is honest.
      const url = input instanceof URL ? input.href : input;
      const seen = (calls.get(url) ?? 0) + 1;
      calls.set(url, seen);
      const route = routes(url, seen);
      return Promise.resolve(
        new Response(route.text ?? JSON.stringify(route.body ?? {}), {
          status: route.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch,
    log: () => undefined,
  };
}

const healthy = (url: string): Route => {
  if (url.endsWith('/readyz')) return { status: 200, body: { ready: true } };
  if (url.endsWith('/api/scans')) return { status: 202, body: { scan: record() } };
  if (url.endsWith('/report')) return { status: 200, body: report('full') };
  return { status: 200, body: record({ status: 'completed', phase: 'report' }) };
};

describe('a healthy deploy', () => {
  it('passes', async () => {
    await expect(runSmoke(deployment(healthy))).resolves.toBeUndefined();
  });

  it('waits through a container that is still warming up', async () => {
    // The normal case, not a failure: a cold container takes a while to launch
    // its first Chromium.
    const options = deployment((url, call) => {
      if (url.endsWith('/readyz')) {
        return call < 3 ? { status: 503, body: { ready: false } } : { status: 200, body: { ready: true } };
      }
      return healthy(url);
    });
    await expect(runSmoke(options)).resolves.toBeUndefined();
  });
});

describe('a broken deploy', () => {
  it('fails when the container never becomes ready', async () => {
    const options = deployment((url) =>
      url.endsWith('/readyz')
        ? { status: 503, text: '{"ready":false,"checks":[{"name":"chromium","ok":false}]}' }
        : healthy(url),
    );

    await expect(waitForReady(options)).rejects.toBeInstanceOf(SmokeFailure);
    // The failure quotes the body, so the deploy log says *which* check failed
    // rather than "the smoke test failed".
    await expect(waitForReady(options)).rejects.toThrow(/chromium/);
  });

  it('fails when the API will not accept a scan', async () => {
    const options = deployment((url) =>
      url.endsWith('/api/scans') ? { status: 500, text: 'boom' } : healthy(url),
    );
    await expect(scanSelf(options)).rejects.toThrow(/expected 202, got 500/);
  });

  it('fails when the worker never picks the job up', async () => {
    // The failure `/readyz` alone would sail straight past: the API is fine,
    // the queue accepted the job, and nothing is consuming it.
    const options = deployment((url) =>
      url.includes('/api/scans/') && !url.endsWith('/report')
        ? { status: 200, body: record({ status: 'queued' }) }
        : healthy(url),
    );
    await expect(runSmoke(options)).rejects.toThrow(/did not finish/);
  });

  it('fails when the scan itself fails', async () => {
    const options = deployment((url) =>
      url.includes('/api/scans/') && !url.endsWith('/report')
        ? {
            status: 200,
            body: record({
              status: 'failed',
              error: { code: 'scan-failed', message: 'no usable sandbox' },
            }),
          }
        : healthy(url),
    );
    await expect(runSmoke(options)).rejects.toThrow(/no usable sandbox/);
  });

  it('fails when the report is not served', async () => {
    const options = deployment((url) =>
      url.endsWith('/report') ? { status: 404, text: 'nope' } : healthy(url),
    );
    await expect(runSmoke(options)).rejects.toThrow(/expected 200, got 404/);
  });

  it('fails when the report does not satisfy the contract', async () => {
    // A serialization bug shipped in a deploy: the scan says completed and
    // every consumer breaks.
    const options = deployment((url) =>
      url.endsWith('/report') ? { status: 200, body: { reportVersion: 1 } } : healthy(url),
    );
    await expect(runSmoke(options)).rejects.toThrow();
  });

  it('fails when the scan completed having measured nothing', async () => {
    // What a container with a broken browser produces. "Completed" is not the
    // claim worth gating a release on.
    const options = deployment((url) =>
      url.endsWith('/report') ? { status: 200, body: report('empty') } : healthy(url),
    );
    await expect(assertReport('scan_smoke', options)).rejects.toThrow(/evaluated zero criteria/);
  });
});
