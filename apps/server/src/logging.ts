import type { FastifyBaseLogger } from 'fastify';
import { pino, type LoggerOptions } from 'pino';

import type { Config } from './config.js';

/**
 * Structured logs, with two properties the plan asks for by name.
 *
 * **`correlationId` is the scan id, everywhere.** One string ties an HTTP
 * request, a queue job, a worker's progress and a user's error message
 * together. When someone reports "scan_9f1c looks wrong", that is the whole
 * search.
 *
 * **Screenshots never appear in a log.** They are pixels of arbitrary websites
 * and can contain anything a page happened to be showing — a logged-in inbox, a
 * medical record, someone's address. The redaction list below is deliberately
 * broad and the serializer below is deliberately blunt: a Buffer never gets
 * logged, whatever key it arrived under.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-token"]',
  'res.headers["set-cookie"]',
  'screenshot',
  'artifact',
  'artifactBytes',
  'bytes',
  'image',
  'png',
  '*.screenshot',
  '*.bytes',
  '*.png',
  'DATABASE_URL',
  'ADMIN_TOKEN',
  'ANTHROPIC_API_KEY',
];

/**
 * Binary is never data worth logging.
 *
 * A `Buffer` in a log line is at best thousands of unreadable bytes and at
 * worst a screenshot. The rule is applied by type rather than by key name,
 * because the key that leaks it will be the one nobody added to the list.
 */
export function replaceBinary(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return `[Buffer ${String(value.byteLength)} bytes]`;
  if (value instanceof Uint8Array) return `[Uint8Array ${String(value.byteLength)} bytes]`;
  if (Array.isArray(value)) return value.map(replaceBinary);

  // Only plain objects are rebuilt. Recursing into every object would flatten
  // class instances into their own enumerable properties — which silently
  // destroyed Fastify's request object (its `method` and `url` are prototype
  // getters) and reduced every request log line to a bare id. An `Error` would
  // go the same way, losing its stack.
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceBinary(item)]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function loggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    // JSON, always. A pretty-printer is for a terminal, and the thing reading
    // these is a log aggregator that wants one object per line.
    formatters: { level: (label) => ({ level: label }) },
    // Applied to what a caller passes, not to child bindings. Doing it in
    // `formatters.log` would run over Fastify's own `{ req }` binding and
    // rebuild it as a plain object, which is how the request serializer came to
    // see an object with no method and no url.
    hooks: {
      logMethod(args, method) {
        const [first, ...rest] = args;
        method.apply(this, [replaceBinary(first), ...rest] as Parameters<typeof method>);
      },
    },
    base: { service: 'handrail-server', role: config.SERVICE_ROLE },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      // Fastify's defaults log the whole URL, which for this API can carry a
      // target site's query string. The path is enough to find a route.
      req: (request: { method?: string; url?: string; id?: string; ip?: string }) => ({
        method: request.method,
        path: typeof request.url === 'string' ? request.url.split('?')[0] : undefined,
        id: request.id,
        ip: request.ip,
      }),
      res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
    },
  };
}

/**
 * Returned as `FastifyBaseLogger`, not as pino's `Logger`.
 *
 * Fastify threads its logger type through every route helper, so handing it the
 * narrower pino type makes a plain `FastifyInstance` parameter incompatible in
 * every `register*Routes` function. The interface Fastify already expects is
 * the right thing to promise.
 */
export function createLogger(config: Config): FastifyBaseLogger {
  return pino(loggerOptions(config));
}

/**
 * The scan id from a request path.
 *
 * Read from the URL rather than from route params because the correlation id
 * has to be bound in `childLoggerFactory`, which runs *before* the handler and
 * receives the raw request — and binding it any later means Fastify's own
 * "incoming request" and "request completed" lines never carry it, which are
 * exactly the two lines someone greps for.
 */
export function correlationIdFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const match = /\/api\/scans\/(scan_[A-Za-z0-9_-]{1,128})(?:[/?]|$)/.exec(url);
  return match?.[1];
}

/** The scan id from a route's params, when there is one. This is the correlation id. */
export function correlationIdFrom(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const id = (params as { id?: unknown }).id;
  return typeof id === 'string' && id.startsWith('scan_') ? id : undefined;
}
