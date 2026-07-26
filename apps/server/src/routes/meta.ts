import { ScanModeSchema } from '@handrail/schemas';
import { CRITERIA_COUNT, coverageSummary } from '@handrail/wcag';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ServerDeps } from '../app.js';
import { MetaResponseSchema } from '../http/schemas.js';

export function registerMetaRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/meta',
    {
      schema: {
        tags: ['meta'],
        summary: 'What this deployment is, and what it has done',
        description:
          'The coverage figures are computed from @handrail/wcag rather than stored, so they ' +
          'cannot describe a version of the criteria catalogue this build does not have.',
        response: { 200: MetaResponseSchema },
      },
    },
    async () => {
      const stats = await deps.store.stats();
      const coverage = coverageSummary('AA');

      return {
        tool: { name: 'handrail' as const, version: deps.toolVersion },
        wcag: {
          version: '2.2' as const,
          criteriaTotal: CRITERIA_COUNT.total,
          levelA: CRITERIA_COUNT.A,
          levelAA: CRITERIA_COUNT.AA,
          withAutomatedCoverage: coverage.withAnyCoverage,
        },
        modes: ScanModeSchema.options,
        scans: stats,
      };
    },
  );

  return Promise.resolve();
}
