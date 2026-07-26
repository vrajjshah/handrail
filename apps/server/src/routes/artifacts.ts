import { artifactId as toArtifactId } from '@handrail/schemas';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ServerDeps } from '../app.js';
import { ProblemSchema, notFound } from '../http/problem.js';
import { ArtifactIdParamsSchema, BinaryResponseSchema } from '../http/schemas.js';
import { ArtifactNotFoundError } from '../store/types.js';

export function registerArtifactRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/artifacts/:id',
    {
      schema: {
        tags: ['reports'],
        summary: 'A screenshot or crop referenced by a finding',
        description:
          'Artifact ids are content-addressed, so the bytes for an id never change and the ' +
          'response is immutable.',
        params: ArtifactIdParamsSchema,
        response: { 200: BinaryResponseSchema, 404: ProblemSchema },
        produces: ['image/png'],
      },
    },
    async (request, reply) => {
      let bytes: Buffer;
      try {
        bytes = await deps.artifacts.get(toArtifactId(request.params.id));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          throw notFound(`No artifact with id ${request.params.id}.`);
        }
        throw error;
      }

      return (
        reply
          .type('image/png')
          // Content-addressed: the same id can never mean different bytes, so a
          // client may keep it forever. Screenshots can contain PII, so the
          // cache is `private` — a shared proxy must not hold one.
          .header('cache-control', 'private, max-age=31536000, immutable')
          .header('content-length', String(bytes.byteLength))
          // Screenshots of arbitrary sites are attacker-influenced bytes.
          // Nothing should sniff them into something executable.
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .send(bytes)
      );
    },
  );

  return Promise.resolve();
}
