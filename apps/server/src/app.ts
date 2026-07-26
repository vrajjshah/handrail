import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
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
import { registerEventRoutes } from './routes/events.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerReportRoutes } from './routes/reports.js';
import { RateLimitedError, registerScanRoutes } from './routes/scans.js';
import { registerWebRoutes, sendAppShell } from './routes/web.js';
import type { ArtifactReader, ScanStore } from './store/types.js';
import type { ScanEventBus } from './events/bus.js';
import type { ReadinessCheck } from './health/checks.js';
import { createLogger, correlationIdFrom, correlationIdFromUrl } from './logging.js';
import type { GuardOptions } from './security/ssrf.js';
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
  /**
   * How a live SSE stream learns that new events exist. Omit and a stream still
   * works — it falls back to its own poll — but with seconds of latency rather
   * than milliseconds.
   */
  eventBus?: ScanEventBus;
  /**
   * Seams for the SSRF guard's resolver and redirect follower, so the abuse
   * tests can probe `127.0.0.1` and a redirect chain without a network.
   */
  ssrf?: GuardOptions;
  /**
   * What `/readyz` proves. Empty means "nothing to check", which is honest for
   * a server with no database rather than a green tick over an empty room.
   */
  readiness?: readonly ReadinessCheck[];
  /**
   * Override the logger. A test seam: the redaction and correlation rules are
   * only observable in what actually reaches the transport, so a test needs to
   * be the transport.
   */
  logger?: FastifyBaseLogger;
  /** Where the built SPA lives. Omit for the default; there is a no-op if absent. */
  web?: { root?: string };
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
    // `loggerInstance`, not `logger`. Fastify 5 takes options under `logger`
    // and a pre-built pino under `loggerInstance`; passing an instance to the
    // former resolves a different overload and infers an HTTP/2 server.
    loggerInstance: deps.logger ?? createLogger(deps.config),
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

  /**
   * One correlation id, bound once, on every line the request produces.
   *
   * `correlationId = scanId` is the plan's rule. It is bound in
   * `childLoggerFactory` rather than in an `onRequest` hook because Fastify has
   * already written "incoming request" by the time a hook runs — and those, plus
   * "request completed", are the two lines anyone actually greps for.
   */
  app.setChildLoggerFactory((logger, bindings, options, rawRequest) => {
    const correlationId = correlationIdFromUrl(rawRequest.url);
    return logger.child(
      correlationId === undefined ? bindings : { ...bindings, correlationId },
      options,
    );
  });

  // Registered before the not-found handler, because Fastify permits exactly
  // one of those per prefix and it has to know whether there is an app to fall
  // back to. With `wildcard: false` this adds a route per file, so it cannot
  // shadow `/api`.
  const servingWeb = await registerWebRoutes(app, deps.web ?? {});

  app.setErrorHandler((error, request, reply) => {
    const correlationId = correlationIdFrom(request.params);

    if (error instanceof HttpError) {
      // A rate limit is a wait, not a failure, and `Retry-After` is how a
      // client is told how long — in a header a machine can act on as well as
      // in prose a person can read.
      if (error instanceof RateLimitedError) {
        void reply.header('retry-after', String(error.retryAfterSeconds));
      }
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

  app.setNotFoundHandler(async (request, reply) => {
    // Anything outside `/api` is a client-side route when there is an app to
    // serve. Answering a bad *API* call with a page of HTML would be the least
    // useful thing a client could receive, so the two are kept apart.
    if (servingWeb && sendAppShell(request)) {
      return reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html');
    }

    return reply.status(404).send(
      ProblemSchema.parse({
        code: 'not-found',
        title: 'Not found',
        detail: `No route matches ${request.method} ${request.url}.`,
        status: 404,
      }),
    );
  });

  await registerScanRoutes(app, deps);
  await registerEventRoutes(app, deps);
  await registerReportRoutes(app, deps);
  await registerArtifactRoutes(app, deps);
  await registerMetaRoutes(app, deps);
  await registerHealthRoutes(app, deps);

  // The document itself, so a client can generate against it. `@fastify/swagger`
  // builds it from the route schemas at `ready()`; nothing here writes JSON.
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.ready();
  return app;
}

