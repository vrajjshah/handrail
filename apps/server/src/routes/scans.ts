import {
  ScanOptionsSchema,
  ScanTargetSchema,
  scanId as toScanId,
  viewportPreset,
  type Viewport,
  type ViewportLabel,
} from '@handrail/schemas';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ServerDeps } from '../app.js';
import { ProblemSchema, notFound } from '../http/problem.js';
import {
  CreateScanBodySchema,
  CreateScanResponseSchema,
  ScanIdParamsSchema,
  ScanResponseSchema,
} from '../http/schemas.js';

function viewportsFor(labels: readonly ViewportLabel[]): Viewport[] {
  const resolved = labels.map(viewportPreset).filter((v): v is Viewport => v !== undefined);
  // The body schema already restricts the labels, so an empty result would mean
  // the presets and the enum have drifted apart — fail loudly rather than
  // silently scanning at whatever the target default happens to be.
  if (resolved.length === 0) throw notFound('none of the requested viewports have a preset');
  return resolved;
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
          'minutes, so the result is followed over the event stream rather than awaited.',
        body: CreateScanBodySchema,
        response: {
          202: CreateScanResponseSchema,
          400: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // The hosted service decides its own caps. A stranger's request supplies
      // the URL and nothing that costs money — #19 tightens this further, but
      // the shape of the decision is here: the server builds the target.
      const target = ScanTargetSchema.parse({
        kind: 'url',
        url: body.url,
        viewports: viewportsFor(body.viewports),
      });
      const options = ScanOptionsSchema.parse({
        mode: body.mode,
        wcagTarget: { level: body.level },
      });

      const scan = await deps.store.create({
        target,
        options,
        ...(request.ip === undefined ? {} : { clientIp: request.ip }),
      });

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
