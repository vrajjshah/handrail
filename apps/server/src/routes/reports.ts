import { buildEvidenceImages, renderReportHtml, renderSarif } from '@handrail/engine';
import { ReportSchema, scanId as toScanId, type Report } from '@handrail/schemas';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ServerDeps } from '../app.js';
import { ProblemSchema, notFound, notReady } from '../http/problem.js';
import { SarifResponseSchema, ScanIdParamsSchema } from '../http/schemas.js';
import type { ScanStore } from '../store/types.js';

async function reportOrThrow(store: ScanStore, id: string): Promise<Report> {
  const stored = await store.get(toScanId(id));
  if (stored === undefined) throw notFound(`No scan with id ${id}.`);
  if (stored.report === undefined) {
    // 409, not 404 — "still running" and "never existed" call for different
    // things from a client, and a status that conflates them makes the wrong
    // one retry.
    throw notReady(
      `Scan ${id} is ${stored.record.status}. The report appears when it finishes; ` +
        `follow /api/scans/${id}/events to know when.`,
    );
  }
  return stored.report;
}

export function registerReportRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/scans/:id/report',
    {
      schema: {
        tags: ['reports'],
        summary: 'The canonical report',
        description:
          'The versioned report.json every other artifact is rendered from. If a rendering ' +
          'disagrees with this document, the rendering is wrong.',
        params: ScanIdParamsSchema,
        response: {
          200: ReportSchema.meta({ id: 'Report' }),
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request) => reportOrThrow(deps.store, request.params.id),
  );

  typed.get(
    '/api/scans/:id/report.html',
    {
      schema: {
        tags: ['reports'],
        summary: 'The self-contained HTML report',
        description:
          'One file with the CSS inlined and screenshots as data URIs, so it can be emailed ' +
          'or attached to a ticket and still work.',
        params: ScanIdParamsSchema,
        response: {
          200: z.string().meta({ description: 'A complete HTML document.' }),
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const report = await reportOrThrow(deps.store, request.params.id);

      // Inlined as data URIs, exactly as the CLI does it — *not* as signed URLs.
      // This file's whole point is that it survives being emailed or attached
      // to a ticket, and a signed URL inside it would be a broken image five
      // minutes later. Signed URLs are for the live UI, which can ask for a new
      // one; a document that is meant to be kept has to carry its evidence.
      const images = await buildEvidenceImages(report, { store: deps.artifacts });

      return reply.type('text/html; charset=utf-8').send(
        renderReportHtml(report, {
          images,
          candidatesRejected: report.scan.counts.candidatesRejected,
        }),
      );
    },
  );

  typed.get(
    '/api/scans/:id/report.sarif',
    {
      schema: {
        tags: ['reports'],
        summary: 'SARIF 2.1.0, for GitHub code scanning',
        description:
          'A projection of the same report. `violation` maps to error and `likely` to ' +
          'warning — a model-sourced finding never fails a build as if it had been measured.',
        params: ScanIdParamsSchema,
        response: {
          200: SarifResponseSchema,
          404: ProblemSchema,
          409: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const report = await reportOrThrow(deps.store, request.params.id);
      return reply.type('application/sarif+json; charset=utf-8').send(renderSarif(report));
    },
  );

  return Promise.resolve();
}
