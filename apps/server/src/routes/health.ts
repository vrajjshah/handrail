import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ServerDeps } from '../app.js';
import { runReadiness } from '../health/checks.js';

const CheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  durationMs: z.number().nonnegative(),
});

const HealthSchema = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  })
  .meta({ id: 'Health' });

const ReadinessSchema = z
  .object({
    ready: z.boolean(),
    version: z.string(),
    checks: z.array(CheckResultSchema),
  })
  .meta({ id: 'Readiness' });

export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const startedAt = Date.now();

  typed.get(
    '/healthz',
    {
      // Liveness is polled constantly and says nothing interesting when it
      // passes; logging every hit would bury the traffic that matters.
      logLevel: 'warn',
      schema: {
        tags: ['meta'],
        summary: 'Liveness',
        description:
          'The process is running and the event loop is turning. It deliberately checks ' +
          'nothing else — a liveness probe that fails when the database does gets the ' +
          'container restarted for somebody else’s outage.',
        response: { 200: HealthSchema },
      },
    },
    () => ({
      status: 'ok' as const,
      version: deps.toolVersion,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  typed.get(
    '/readyz',
    {
      logLevel: 'warn',
      schema: {
        tags: ['meta'],
        summary: 'Readiness',
        description:
          'Whether a scan can actually run: Postgres, the queue, and a real Chromium ' +
          'launch. "The container is up" and "a scan can run" are different claims, and ' +
          'only the second one is worth serving traffic on. 503 when any check fails.',
        response: { 200: ReadinessSchema, 503: ReadinessSchema },
      },
    },
    async (_request, reply) => {
      const result = await runReadiness(deps.readiness ?? []);
      // 503, so a load balancer stops sending scans to a container that cannot
      // run them — while `/healthz` keeps it alive long enough to be diagnosed
      // rather than restarted into the same state.
      return reply.status(result.ready ? 200 : 503).send({
        ready: result.ready,
        version: deps.toolVersion,
        checks: result.checks,
      });
    },
  );

  return Promise.resolve();
}
