import { artifactId as toArtifactId, type ArtifactId } from '@handrail/schemas';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ServerDeps } from '../app.js';
import { ARTIFACT_RETENTION_DAYS } from '../artifacts/policy.js';
import { HttpError, ProblemSchema, notFound } from '../http/problem.js';
import { ArtifactIdParamsSchema, BinaryResponseSchema } from '../http/schemas.js';
import { ArtifactExpiredError, ArtifactNotFoundError } from '../store/types.js';

/** The cache is never allowed to outlive the retention window. */
const RETENTION_SECONDS = ARTIFACT_RETENTION_DAYS * 24 * 60 * 60;

/**
 * The artifact route, and the one design decision #22 had to make.
 *
 * **The path stays; it stops being a byte proxy.** Artifact ids are embedded in
 * `report.json`, in the SARIF projection and in every finding — documents that
 * get attached to tickets and re-read next week. A signed URL written into one
 * of those is a link that is already broken. So the durable reference stays a
 * stable, unsigned path on our own origin, and that path *issues* the
 * capability instead of *being* it: `302` to a presigned R2 URL that lives for
 * five minutes.
 *
 * What that buys over the proxy it replaces:
 *
 * - The old route was an open, permanent read for anyone holding an id, with no
 *   expiry anywhere in the system. The redirect is the only place a capability
 *   is minted, so retention can be applied *before* one exists.
 * - The bytes come from R2 rather than through a container that is also running
 *   Chromium. Screenshots of arbitrary sites are the largest thing this service
 *   moves.
 * - A leaked URL — a proxy log, a pasted link, a shared screen — stops working
 *   in minutes rather than never.
 *
 * The byte-serving branch survives for the store that cannot sign: a developer
 * running without R2, and every route test. That is not a silent downgrade —
 * `/readyz` reports whether this deployment has object storage, and the boot
 * log says so — it is the same route being honest about two deployments.
 */
export function registerArtifactRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/artifacts/:id',
    {
      schema: {
        tags: ['reports'],
        summary: 'A screenshot or crop referenced by a finding',
        description:
          'Redirects (302) to a short-lived signed URL for the bytes. Artifact ids are ' +
          'content-addressed, so this path is stable and safe to store; the URL it hands out ' +
          `is not, and expires in minutes. Screenshots are deleted ${String(ARTIFACT_RETENTION_DAYS)} ` +
          'days after capture, after which this returns 410.',
        params: ArtifactIdParamsSchema,
        // No schema for the 302: it has no body, and declaring one would put
        // this route's serializer on a path that never carries a payload.
        response: {
          200: BinaryResponseSchema,
          404: ProblemSchema,
          410: ProblemSchema,
        },
        produces: ['image/png'],
      },
    },
    async (request, reply) => {
      const id = toArtifactId(request.params.id);

      const url = await signedUrlOrThrow(deps, id);
      if (url !== undefined) {
        return (
          reply
            // Never cached. A stored redirect outlives the signature it points
            // at, and the next visitor gets a 403 from a URL they have no way
            // of seeing has expired. `no-store` also keeps the signature itself
            // out of any shared cache.
            .header('cache-control', 'no-store')
            .header('referrer-policy', 'no-referrer')
            .redirect(url, 302)
        );
      }

      const bytes = await bytesOrThrow(deps, id);
      return (
        reply
          .type('image/png')
          // Content-addressed, so `immutable` is true of the bytes: the same id
          // can never mean different ones. The max-age is the retention window
          // rather than a year, because a client that cached this for a year
          // would still be showing a screenshot the deployment had deleted —
          // a cache outliving the policy is the policy not applying.
          .header('cache-control', `private, max-age=${String(RETENTION_SECONDS)}, immutable`)
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

/** 410 Gone. The artifact existed; retention ended it. */
function gone(detail: string): HttpError {
  return new HttpError(410, 'artifact-expired', 'That screenshot has been deleted', detail);
}

function rethrowAsHttp(error: unknown, id: string): never {
  if (error instanceof ArtifactExpiredError) {
    throw gone(
      `Artifact ${id} was captured more than ${String(ARTIFACT_RETENTION_DAYS)} days ago ` +
        'and has been deleted. ' +
        'Screenshots may contain personal data, so they are not kept; re-run the scan for ' +
        'fresh evidence.',
    );
  }
  if (error instanceof ArtifactNotFoundError) {
    throw notFound(`No artifact with id ${id}.`);
  }
  throw error;
}

async function signedUrlOrThrow(deps: ServerDeps, id: ArtifactId): Promise<string | undefined> {
  try {
    return await deps.artifacts.signedUrl(id);
  } catch (error) {
    rethrowAsHttp(error, id);
  }
}

async function bytesOrThrow(deps: ServerDeps, id: ArtifactId): Promise<Buffer> {
  try {
    return await deps.artifacts.get(id);
  } catch (error) {
    rethrowAsHttp(error, id);
  }
}
