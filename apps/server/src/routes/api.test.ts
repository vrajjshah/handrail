import {
  ReportSchema,
  ScanRecordSchema,
  artifactId as toArtifactId,
  scanId as toScanId,
} from '@handrail/schemas';
import { CRITERIA_COUNT } from '@handrail/wcag';
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryArtifactCatalog } from '../artifacts/catalog.js';
import { ARTIFACT_RETENTION_DAYS, SIGNED_URL_TTL_SECONDS } from '../artifacts/policy.js';
import { CatalogArtifactReader, ScanArtifactStore } from '../artifacts/store.js';
import { HOSTED_LIMITS } from '../security/limits.js';
import { SigningObjectStore } from '../__test__/signing-object-store.js';
import { completeScan, harness, testFinding, type Harness } from '../__test__/harness.js';

let current: Harness | undefined;

async function server(): Promise<Harness> {
  current = await harness();
  return current;
}

afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

describe('POST /api/scans', () => {
  it('accepts a url and answers 202 with the queued scan', async () => {
    const { app } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com' },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json<{ scan: unknown; links: Record<string, string> }>();
    // The response body *is* a ScanRecord — asserted by parsing it with the
    // engine's own contract rather than by eyeballing a few fields.
    const scan = ScanRecordSchema.parse(body.scan);
    expect(scan.status).toBe('queued');
    expect(scan.phase).toBe('queued');
    expect(body.links.events).toBe(`/api/scans/${scan.id}/events`);
  });

  it('defaults to the free offline mode rather than one that spends money', async () => {
    const { app } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com' },
    });
    expect(ScanRecordSchema.parse(response.json<{ scan: unknown }>().scan).options.mode).toBe(
      'deterministic',
    );
  });

  it('resolves viewport labels to the shared presets', async () => {
    const { app } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com', viewports: ['reflow-320'] },
    });
    const scan = ScanRecordSchema.parse(response.json<{ scan: unknown }>().scan);
    expect(scan.target.viewports).toEqual([
      { label: 'reflow-320', width: 320, height: 800, deviceScaleFactor: 1 },
    ]);
  });

  it.each([
    ['not a url', { url: 'nonsense' }],
    ['a non-http scheme', { url: 'file:///etc/passwd' }],
    ['a missing url', {}],
    ['an unknown viewport', { url: 'https://example.com', viewports: ['holodeck'] }],
    ['an unknown mode', { url: 'https://example.com', mode: 'telepathy' }],
  ])('rejects %s with a problem document', async (_label, payload) => {
    const { app } = await server();
    const response = await app.inject({ method: 'POST', url: '/api/scans', payload });
    expect(response.statusCode).toBe(400);
    const problem = response.json<{ code: string; status: number; detail: string }>();
    expect(problem.status).toBe(400);
    expect(problem.code).toBe('invalid-request');
    expect(problem.detail.length).toBeGreaterThan(0);
  });

  it('will not let a request set the crawl caps or the budget', async () => {
    // The hosted service pays for the scan, so the ceilings are not negotiable
    // from outside. The body schema has no field to express them, and anything
    // extra is dropped rather than honoured.
    const { app } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com', crawl: { maxPages: 500 }, budget: { maxUsd: 100 } },
    });
    const scan = ScanRecordSchema.parse(response.json<{ scan: unknown }>().scan);
    expect(scan.target.kind).toBe('url');
    if (scan.target.kind !== 'url') throw new Error('expected a url target');
    // The hosted ceilings from #19, not the schema defaults — the server
    // decides what a stranger's scan may cost, and it decides downwards.
    expect(scan.target.crawl.maxPages).toBe(HOSTED_LIMITS.maxPages);
    expect(scan.target.budget.maxUsd).toBe(HOSTED_LIMITS.maxUsd);
  });
});

describe('GET /api/scans/:id', () => {
  it('returns the record', async () => {
    const harnessed = await server();
    const { id } = await completeScan(harnessed);
    const response = await harnessed.app.inject({ url: `/api/scans/${id}` });
    expect(response.statusCode).toBe(200);
    expect(ScanRecordSchema.parse(response.json()).id).toBe(id);
  });

  it('404s an unknown id with the id in the message', async () => {
    const { app } = await server();
    const response = await app.inject({ url: '/api/scans/scan_nope' });
    expect(response.statusCode).toBe(404);
    const problem = response.json<{ code: string; detail: string; correlationId?: string }>();
    expect(problem.code).toBe('not-found');
    expect(problem.detail).toContain('scan_nope');
    // The id a user can quote is the id that indexes the logs.
    expect(problem.correlationId).toBe('scan_nope');
  });
});

describe('report routes', () => {
  it('serves the canonical report, and it parses as one', async () => {
    const harnessed = await server();
    const { id } = await completeScan(harnessed, [testFinding()]);
    const response = await harnessed.app.inject({ url: `/api/scans/${id}/report` });
    expect(response.statusCode).toBe(200);
    const report = ReportSchema.parse(response.json());
    expect(report.findings).toHaveLength(1);
    expect(report.coverage.criteriaTotal).toBe(CRITERIA_COUNT.total);
  });

  it('serves a self-contained HTML rendering', async () => {
    const harnessed = await server();
    const { id } = await completeScan(harnessed, [testFinding()]);
    const response = await harnessed.app.inject({ url: `/api/scans/${id}/report.html` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<!doctype html>');
    // Self-contained means self-contained: no stylesheet or script fetched from
    // anywhere, so the file still works attached to an email.
    expect(response.body).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(response.body).not.toMatch(/<script[^>]+src=/i);
  });

  it('serves SARIF that a code-scanning ingest would accept', async () => {
    const harnessed = await server();
    const { id } = await completeScan(harnessed, [testFinding()]);
    const response = await harnessed.app.inject({ url: `/api/scans/${id}/report.sarif` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/sarif+json');
    const log = response.json<{
      version: string;
      runs: { results: { level: string }[]; tool: { driver: { name: string } } }[];
    }>();
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0]?.tool.driver.name).toBe('Handrail');
    expect(log.runs[0]?.results[0]?.level).toBe('error');
  });

  it('says "not ready" rather than "not found" while a scan is still running', async () => {
    // A client that cannot tell a typo from a wait will retry the wrong one.
    const harnessed = await server();
    const created = await harnessed.app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { url: 'https://example.com' },
    });
    const id = ScanRecordSchema.parse(created.json<{ scan: unknown }>().scan).id;

    for (const suffix of ['report', 'report.html', 'report.sarif']) {
      const response = await harnessed.app.inject({ url: `/api/scans/${id}/${suffix}` });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('not-ready');
    }
  });

  it.each(['report', 'report.html', 'report.sarif'])('404s %s for an unknown scan', async (suffix) => {
    const { app } = await server();
    const response = await app.inject({ url: `/api/scans/scan_nope/${suffix}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/artifacts/:id', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  it('serves the bytes as an immutable, private, non-sniffable PNG', async () => {
    const harnessed = await server();
    harnessed.artifacts.put('full_a1b2c3d4' as never, png);
    const response = await harnessed.app.inject({ url: '/api/artifacts/full_a1b2c3d4' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.rawPayload.equals(png)).toBe(true);
    // Screenshots can contain PII, so a shared cache must not hold one.
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('404s an unknown artifact', async () => {
    const { app } = await server();
    const response = await app.inject({ url: '/api/artifacts/full_deadbeef' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('not-found');
  });

  it.each(['../../etc/passwd', '..%2f..%2fetc', 'full_../x', 'FULL_A1B2C3D4'])(
    'rejects %s before it can reach a path join',
    async (id) => {
      const { app } = await server();
      const response = await app.inject({ url: `/api/artifacts/${encodeURIComponent(id)}` });
      expect(response.statusCode).toBe(400);
    },
  );
});

describe('GET /api/scans/:id/report.html', () => {
  /** A real 1×1 PNG: `buildEvidenceImages` reads its dimensions with sharp. */
  const ONE_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('inlines evidence images as data URIs rather than linking to them', async () => {
    // The hosted report used to render with no evidence images at all, because
    // nothing ever wrote an artifact. Now that one exists, it is inlined — a
    // signed URL inside a document meant to be emailed would be a broken image
    // by the time anyone opened it.
    const harnessed = await server();
    harnessed.artifacts.put(toArtifactId('full_a1b2c3d4'), ONE_PIXEL);

    const finding = testFinding({
      evidence: [{ kind: 'screenshot', artifactId: toArtifactId('full_a1b2c3d4') }],
    });
    const { id } = await completeScan(harnessed, [finding]);

    const response = await harnessed.app.inject({ url: `/api/scans/${id}/report.html` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data:image/png;base64,');
  });

  it('still renders when the artifact has gone', async () => {
    // A missing screenshot is a gap in the report, not a 500. Fourteen days
    // after a scan, this is the normal case.
    const harnessed = await server();
    const finding = testFinding({
      evidence: [{ kind: 'screenshot', artifactId: toArtifactId('full_deadbeef') }],
    });
    const { id } = await completeScan(harnessed, [finding]);

    const response = await harnessed.app.inject({ url: `/api/scans/${id}/report.html` });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('data:image/png;base64,');
  });
});

describe('GET /api/artifacts/:id against a store that can sign', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const CAPTURED = new Date('2026-08-01T00:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** A server whose artifacts live in a signing object store, as they do in production. */
  async function signingServer(now: Date): Promise<{ harnessed: Harness; id: string }> {
    const objects = new SigningObjectStore();
    const catalog = new MemoryArtifactCatalog();
    const id = await new ScanArtifactStore({
      scanId: toScanId('scan_1'),
      objects,
      catalog,
      now: () => CAPTURED,
    }).put(png, 'full');

    current = await harness({
      artifacts: new CatalogArtifactReader({ objects, catalog, now: () => now }),
    });
    return { harnessed: current, id };
  }

  it('redirects to a signed, expiring URL rather than proxying the bytes', async () => {
    // The acceptance clause. The stable path is what a report embeds; the
    // capability it hands out is minted per request and dies in minutes.
    const { harnessed, id } = await signingServer(new Date(CAPTURED.getTime() + DAY_MS));
    const response = await harnessed.app.inject({ url: `/api/artifacts/${id}` });

    expect(response.statusCode).toBe(302);
    const location = String(response.headers.location);
    expect(location).toContain('X-Amz-Signature=');
    expect(location).toContain(`X-Amz-Expires=${String(SIGNED_URL_TTL_SECONDS)}`);
    expect(response.rawPayload.byteLength).toBe(0);
  });

  it('never lets the redirect itself be cached', async () => {
    // A stored redirect outlives the signature it points at, and the next
    // visitor gets a 403 from a URL they cannot see has expired.
    const { harnessed, id } = await signingServer(new Date(CAPTURED.getTime() + DAY_MS));
    const response = await harnessed.app.inject({ url: `/api/artifacts/${id}` });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('shortens the capability so it cannot outlive the artifact', async () => {
    const oneMinuteLeft = new Date(
      CAPTURED.getTime() + ARTIFACT_RETENTION_DAYS * DAY_MS - 60_000,
    );
    const { harnessed, id } = await signingServer(oneMinuteLeft);
    const response = await harnessed.app.inject({ url: `/api/artifacts/${id}` });
    expect(response.headers.location).toContain('X-Amz-Expires=60');
  });

  it('410s once retention has run out, rather than 404', async () => {
    // "Deleted on a schedule" and "you typed the id wrong" call for different
    // things from a client, and one of them should stop retrying.
    const past = new Date(CAPTURED.getTime() + (ARTIFACT_RETENTION_DAYS + 1) * DAY_MS);
    const { harnessed, id } = await signingServer(past);
    const response = await harnessed.app.inject({ url: `/api/artifacts/${id}` });

    expect(response.statusCode).toBe(410);
    expect(response.json<{ code: string }>().code).toBe('artifact-expired');
  });

  it('404s an id the catalog never heard of', async () => {
    const { harnessed } = await signingServer(new Date(CAPTURED.getTime() + DAY_MS));
    const response = await harnessed.app.inject({ url: '/api/artifacts/full_deadbeef' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/meta', () => {
  it('reports the criteria catalogue this build actually has', async () => {
    const { app } = await server();
    const body = (await app.inject({ url: '/api/meta' })).json<{
      wcag: { criteriaTotal: number; levelA: number; levelAA: number };
      tool: { version: string };
      modes: string[];
    }>();

    // 31 + 24, not 30 + 25 — WCAG 2.2 removed 4.1.1 and two of its additions
    // are Level A. Computed from @handrail/wcag, never stored.
    expect(body.wcag.criteriaTotal).toBe(55);
    expect(body.wcag.levelA).toBe(31);
    expect(body.wcag.levelAA).toBe(24);
    expect(body.tool.version).toBe('9.9.9-test');
    expect(body.modes).toContain('deterministic');
  });

  it('reports percentiles over completed scans', async () => {
    const harnessed = await server();
    await completeScan(harnessed);
    const stats = (await harnessed.app.inject({ url: '/api/meta' })).json<{
      scans: { total: number; completed: number; durationMs: { p50: number | null } };
    }>().scans;

    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.durationMs.p50).toBe(20_000);
  });

  it('reports null percentiles rather than zero when nothing has finished', async () => {
    // Zero would read as "instant scans", which is a lie a dashboard will
    // happily draw a flat green line for.
    const { app } = await server();
    const stats = (await app.inject({ url: '/api/meta' })).json<{
      scans: { durationMs: { p50: number | null; p95: number | null } };
    }>().scans;
    expect(stats.durationMs).toEqual({ p50: null, p95: null });
  });
});

describe('errors', () => {
  it('answers an unknown route with the same problem shape', async () => {
    const { app } = await server();
    const response = await app.inject({ url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string; status: number }>()).toMatchObject({
      code: 'not-found',
      status: 404,
    });
  });
});
