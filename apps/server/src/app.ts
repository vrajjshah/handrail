import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Config } from './config.js';
import { HttpError, ProblemSchema } from './http/problem.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerScanRoutes } from './routes/scans.js';
import type { ArtifactReader, ScanStore } from './store/types.js';
import type { ScanQueue } from './worker/queue.js';

export interface ServerDeps {
  config: Config;
  store: ScanStore;
  artifacts: ArtifactReader;
  /** Handrail's own version, reported by `/api/meta` and stamped into reports. */
  toolVersion: string;
  /**
   * Where a submitted scan goes.
   *
   * Optional, and its absence is visible rather than silent: without a queue
   * the scan stays `queued` forever and `/readyz` says the queue is missing. A
   * server that accepted work it could not do and looked healthy doing it would
   * be the worst of the options.
   */
  queue?: ScanQueue;
}

/**
 * Build the API.
 *
 * The OpenAPI document is *generated* from the same Zod schemas that validate
 * the traffic — there is no hand-written spec to fall out of date, and a route
 * whose schema stops matching `@handrail/schemas` stops typechecking. That is
 * the whole reason the plan picked this type provider.
 *
 * Returned rather than listened on, so tests drive it with `inject()` and never
 * open a socket.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // Fastify's own logger is replaced with a configured pino instance in #20;
    // until then the level is honoured and the output is still JSON.
    logger: { level: deps.config.LOG_LEVEL },
    // Behind Railway's proxy the client address is in `X-Forwarded-For`, and
    // #19's per-IP limits are worthless if every request looks like it came
    // from the load balancer.
    trustProxy: true,
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Handrail',
        version: deps.toolVersion,
        description:
          'Evidence-first WCAG 2.2 scanning. Every finding carries the evidence it was made ' +
          'from, and the coverage ledger lists what was not tested rather than hiding it.',
        license: { name: 'MIT', url: 'https://github.com/vrajjshah/handrail/blob/main/LICENSE' },
      },
      servers: [{ url: deps.config.PUBLIC_URL }],
      tags: [
        { name: 'scans', description: 'Submit a scan and follow it.' },
        { name: 'reports', description: 'The canonical report and its renderings.' },
        { name: 'meta', description: 'What this deployment is and what it has done.' },
      ],
    },
    transform: createJsonSchemaTransform({}),
    transformObject: createJsonSchemaTransformObject({}),
  });

  app.setErrorHandler((error, request, reply) => {
    const correlationId = correlationIdOf(request.params);

    if (error instanceof HttpError) {
      void reply.status(error.status).send(error.toProblem(correlationId));
      return;
    }

    // A schema rejection is the client's problem and says which field; anything
    // else is ours and must not leak an internal message to a stranger.
    if (isValidationError(error)) {
      void reply.status(400).send(
        ProblemSchema.parse({
          code: 'invalid-request',
          title: 'That request could not be accepted',
          detail: error.message,
          status: 400,
          ...(correlationId === undefined ? {} : { correlationId }),
        }),
      );
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send(
      ProblemSchema.parse({
        code: 'internal-error',
        title: 'Something went wrong on our side',
        detail: 'The failure has been logged. Try again, and quote the correlation id if it persists.',
        status: 500,
        ...(correlationId === undefined ? {} : { correlationId }),
      }),
    );
  });

  /**
   * Fastify marks a schema rejection with `validation`, and the message names
   * the offending field. Everything else is ours: a stranger gets the
   * correlation id and nothing about our internals.
   */
  function isValidationError(error: unknown): error is { message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      (error as { validation?: unknown }).validation !== undefined
    );
  }

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(
      ProblemSchema.parse({
        code: 'not-found',
        title: 'Not found',
        detail: `No route matches ${request.method} ${request.url}.`,
        status: 404,
      }),
    );
  });

  await registerScanRoutes(app, deps);
  await registerReportRoutes(app, deps);
  await registerArtifactRoutes(app, deps);
  await registerMetaRoutes(app, deps);

  // The document itself, so a client can generate against it. `@fastify/swagger`
  // builds it from the route schemas at `ready()`; nothing here writes JSON.
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.ready();
  return app;
}

/** The scan id from a route's params, when it has one. Used as the correlation id. */
function correlationIdOf(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const id = (params as { id?: unknown }).id;
  return typeof id === 'string' && id.startsWith('scan_') ? id : undefined;
}
