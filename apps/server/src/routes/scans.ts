import {
  ScanOptionsSchema,
  ScanTargetSchema,
  scanId as toScanId,
  viewportPreset,
  type Viewport,
  type ViewportLabel,
} from '@handrail/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ServerDeps } from '../app.js';
import { HttpError, ProblemSchema, notFound } from '../http/problem.js';
import {
  CreateScanBodySchema,
  CreateScanResponseSchema,
  ScanIdParamsSchema,
  ScanResponseSchema,
} from '../http/schemas.js';
import {
  HOSTED_LIMITS,
  RATE_WINDOW_MS,
  checkLimits,
  limitMessage,
  matchesAdminToken,
} from '../security/limits.js';
import { SsrfBlockedError, assertSafeUrl } from '../security/ssrf.js';

function viewportsFor(labels: readonly ViewportLabel[]): Viewport[] {
  const resolved = labels.map(viewportPreset).filter((v): v is Viewport => v !== undefined);
  // The body schema already restricts the labels, so an empty result would mean
  // the presets and the enum have drifted apart — fail loudly rather than
  // silently scanning at whatever the target default happens to be.
  if (resolved.length === 0) throw notFound('none of the requested viewports have a preset');
  return resolved;
}

/**
 * Rate limiting, before anything expensive happens.
 *
 * The counts come from the `scans` table rather than an in-process counter, so
 * a restart does not hand everyone a fresh allowance — and on a deployment with
 * two containers the limit is still one limit rather than one each.
 */
async function enforceLimits(request: FastifyRequest, deps: ServerDeps): Promise<void> {
  if (isAdmin(request, deps)) {
    request.log.info({ ip: request.ip }, 'admin token accepted: limits bypassed');
    return;
  }

  const now = new Date();
  const [recentByIp, runningNow] = await Promise.all([
    deps.store.recentScanTimesForIp(request.ip, new Date(now.getTime() - RATE_WINDOW_MS)),
    deps.store.countRunning(),
  ]);

  const decision = checkLimits({ recentByIp, runningNow, now });
  if (decision.allowed) return;

  // 429 with a `Retry-After`, and a message that says when in words. This is
  // not an error state — it is an explained wait (DESIGN.md §8.2).
  throw new RateLimitedError(limitMessage(decision), decision.retryAfterSeconds ?? 60);
}

class RateLimitedError extends HttpError {
  readonly retryAfterSeconds: number;

  constructor(detail: string, retryAfterSeconds: number) {
    super(429, 'rate-limited', 'Too many scans for now', detail);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isAdmin(request: FastifyRequest, deps: ServerDeps): boolean {
  const header = request.headers['x-admin-token'];
  const provided = Array.isArray(header) ? header[0] : header;
  return matchesAdminToken(provided, deps.config.ADMIN_TOKEN);
}

export function registerScanRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/api/scans',
    {
      schema: {
        tags: ['scans'],
        summary: 'Submit a scan',
        description:
          'Accepts the URL and queues the scan. Returns 202 immediately — a scan takes ' +
          'minutes, so the result is followed over the event stream rather than awaited. ' +
          'The URL is checked against the SSRF guard first, including every redirect it ' +
          'leads to, and the per-IP and global limits are enforced before anything is queued.',
        body: CreateScanBodySchema,
        response: {
          202: CreateScanResponseSchema,
          400: ProblemSchema,
          422: ProblemSchema,
          429: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      await enforceLimits(request, deps);

      // The guard runs *before* the scan row exists, so a rejected probe leaves
      // nothing behind but a log line. It follows redirects one hop at a time
      // and judges each: a public URL that 302s to 169.254.169.254 is the
      // standard bypass, and checking only what the user typed does not see it.
      let finalUrl: string;
      try {
        const verdict = await assertSafeUrl(body.url, deps.ssrf ?? {});
        finalUrl = verdict.finalUrl.toString();
        if (verdict.chain.length > 1) {
          request.log.info({ chain: verdict.chain }, 'redirect chain validated');
        }
      } catch (error) {
        if (error instanceof SsrfBlockedError) {
          request.log.warn(
            { url: body.url, reason: error.reason, ip: request.ip },
            'SSRF guard rejected a target',
          );
          // 422 rather than 400: the request was well-formed, and what it asked
          // for is refused. A client should not retry it unchanged.
          throw new HttpError(422, `ssrf-${error.reason}`, 'That target cannot be scanned', error.message);
        }
        throw error;
      }

      // The hosted service pays for the scan, so the ceilings are not
      // negotiable from outside. The body has no field that could express them;
      // this is where they are applied.
      const target = ScanTargetSchema.parse({
        kind: 'url',
        url: finalUrl,
        viewports: viewportsFor(body.viewports),
        crawl: { maxPages: HOSTED_LIMITS.maxPages },
        budget: {
          maxUsd: HOSTED_LIMITS.maxUsd,
          maxDurationMs: HOSTED_LIMITS.maxDurationMs,
          maxModelTokens: HOSTED_LIMITS.maxModelTokens,
        },
      });
      const options = ScanOptionsSchema.parse({
        mode: body.mode,
        wcagTarget: { level: body.level },
        budgetUsd: HOSTED_LIMITS.maxUsd,
      });

      const scan = await deps.store.create({
        target,
        options,
        ...(request.ip === undefined ? {} : { clientIp: request.ip }),
      });

      // Enqueued after the row exists, never before: a worker that picked the
      // job up first would look up a scan that had not been written yet. The
      // row is the fact; the job is a notification about it.
      if (deps.queue === undefined) {
        request.log.warn(
          { scanId: scan.id },
          'no queue configured — this scan will stay queued and never run',
        );
      } else {
        await deps.queue.publish({ scanId: scan.id });
      }

      const base = `/api/scans/${scan.id}`;
      return reply.status(202).send({
        scan,
        links: { self: base, events: `${base}/events`, report: `${base}/report` },
      });
    },
  );

  typed.get(
    '/api/scans/:id',
    {
      schema: {
        tags: ['scans'],
        summary: 'Read a scan',
        params: ScanIdParamsSchema,
        response: {
          200: ScanResponseSchema,
          404: ProblemSchema,
        },
      },
    },
    async (request) => {
      const stored = await deps.store.get(toScanId(request.params.id));
      if (stored === undefined) throw notFound(`No scan with id ${request.params.id}.`);
      return stored.record;
    },
  );

  return Promise.resolve();
}

export { RateLimitedError };
