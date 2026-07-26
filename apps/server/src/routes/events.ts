import { isTerminalEvent, scanId as toScanId, type ScanEvent, type ScanId } from '@handrail/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ServerDeps } from '../app.js';
import {
  SSE_HEADERS,
  frameComment,
  frameEvent,
  frameRetry,
  parseLastEventId,
} from '../events/sse.js';
import { ProblemSchema, notFound } from '../http/problem.js';
import { ScanIdParamsSchema } from '../http/schemas.js';
import type { ScanStore } from '../store/types.js';

/**
 * `Last-Event-ID` as a query parameter, for clients that cannot send a header.
 * `EventSource` cannot, and neither can a curl in a bug report.
 */
const LastEventIdQuerySchema = z.object({
  lastEventId: z.string().max(32).optional(),
});

/** How often a comment frame goes out to keep proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

/**
 * A safety net under the notification.
 *
 * `NOTIFY` is best-effort: a dropped connection, a restarted database or a
 * missed wake-up loses the nudge, not the rows. Reading periodically anyway
 * turns that from a stalled stream into a few seconds of extra latency. It is
 * deliberately slow — the notification is the fast path, this is the floor.
 */
const POLL_MS = 3_000;

interface StreamState {
  lastSent: number;
  finished: boolean;
}

/**
 * `GET /api/scans/:id/events`.
 *
 * The contract that matters: **reconnecting replays every missed event exactly
 * once, in order.** That works because `ScanEvent.seq` is the SSE event id and
 * `scan_events` is keyed on `(scan_id, seq)` — so "what have I already seen" is
 * a number the client hands back, and "what am I owed" is a range query. No
 * cursor to keep, no window to age out, and no way for the answer to be
 * approximate.
 *
 * The ordering inside the handler is the other half. Subscribe **first**, then
 * read the backlog. Doing it the other way leaves a gap between the read and
 * the subscription in which an event can be written and never delivered — the
 * classic mistake, and invisible until a scan is fast.
 */
export function registerEventRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/scans/:id/events',
    {
      schema: {
        tags: ['scans'],
        summary: 'Watch a scan happen',
        description:
          'Server-sent events. The event id is the scan event `seq`, so reconnecting with ' +
          '`Last-Event-ID` replays exactly what was missed — nothing twice, nothing skipped. ' +
          'Returns 204 when the scan has already finished and the client has seen it all, ' +
          'which is how an EventSource is told to stop reconnecting.',
        params: ScanIdParamsSchema,
        querystring: LastEventIdQuerySchema,
        response: { 204: z.null(), 404: ProblemSchema },
        produces: ['text/event-stream'],
      },
    },
    async (request, reply) => {
      const id = toScanId(request.params.id);
      const stored = await deps.store.get(id);
      if (stored === undefined) throw notFound(`No scan with id ${request.params.id}.`);

      // The spec sends it as a header on reconnect. The query parameter is for
      // clients that cannot set one — `EventSource` cannot, and neither can a
      // curl in a bug report.
      const lastSeq = Math.max(
        parseLastEventId(request.headers['last-event-id']),
        parseLastEventId(request.query.lastEventId),
      );

      const backlog = await deps.store.eventsSince(id, lastSeq);
      const alreadyFinished = backlog.some(isTerminalEvent) || isFinished(stored.record.status);

      // Nothing left to say and nothing more coming. 204 is how the SSE spec
      // tells an EventSource to stop reconnecting; closing a 200 would make it
      // retry forever against a scan that ended yesterday.
      if (backlog.length === 0 && alreadyFinished) {
        return reply.status(204).send(null);
      }

      return streamEvents({ reply, store: deps.store, deps, id, lastSeq, backlog });
    },
  );

  return Promise.resolve();
}

function isFinished(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

interface StreamArgs {
  reply: FastifyReply;
  store: ScanStore;
  deps: ServerDeps;
  id: ScanId;
  lastSeq: number;
  backlog: ScanEvent[];
}

async function streamEvents(args: StreamArgs): Promise<FastifyReply> {
  const { reply, store, deps, id } = args;
  const state: StreamState = { lastSent: args.lastSeq, finished: false };

  // Fastify must stop managing this response: the handler returns while the
  // socket stays open, and without hijacking, Fastify would send its own reply
  // on top of the stream.
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  // Suggest a short reconnect: the whole point of exact replay is that
  // reconnecting is cheap and safe.
  reply.raw.write(frameRetry(2_000));

  const send = (event: ScanEvent): void => {
    if (event.seq <= state.lastSent) return;
    reply.raw.write(frameEvent(event));
    state.lastSent = event.seq;
    if (isTerminalEvent(event)) state.finished = true;
  };

  // Declared before `finish` so it can clear them, assigned after `drain`
  // exists so the subscription can call it. The ordering is the point: the
  // subscription must be live before the backlog is read.
  const timers: { unsubscribe?: () => Promise<void>; heartbeat?: NodeJS.Timeout; poll?: NodeJS.Timeout } = {};
  let closing = false;

  const finish = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (timers.heartbeat !== undefined) clearInterval(timers.heartbeat);
    if (timers.poll !== undefined) clearInterval(timers.poll);
    await timers.unsubscribe?.();
    if (!reply.raw.writableEnded) reply.raw.end();
  };

  // Serialised: two overlapping drains would interleave writes and could send
  // the same event twice, which is the one thing this endpoint promises not to.
  let draining: Promise<void> = Promise.resolve();
  const drain = (): Promise<void> => {
    draining = draining.then(async () => {
      if (reply.raw.writableEnded) return;
      if (!state.finished) {
        for (const event of await store.eventsSince(id, state.lastSent)) send(event);
      }
      // Checked after the read *and* on a drain that skipped it, because the
      // terminal event can arrive two ways: live on any notification, or
      // already sitting in the backlog a reconnecting client was handed.
      // Missing either leaves the client on a socket that will never speak again.
      if (state.finished) await finish();
    });
    return draining;
  };

  // Subscribe before reading the backlog. Between the read and the
  // subscription is exactly where an event goes missing, and a missing event in
  // a stream keyed by `seq` means a client that waits forever for a scan that
  // finished.
  if (deps.eventBus !== undefined) {
    timers.unsubscribe = await deps.eventBus.subscribe(id, () => void drain());
  }

  for (const event of args.backlog) send(event);

  timers.heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(frameComment('keep-alive'));
  }, HEARTBEAT_MS);
  // A stream must never be the reason a process cannot exit.
  timers.heartbeat.unref?.();

  timers.poll = setInterval(() => void drain(), POLL_MS);
  timers.poll.unref?.();

  reply.raw.on('close', () => void finish());

  // If the backlog already carried the terminal event there is nothing to wait
  // for; otherwise the stream stays open until the scan ends or the client
  // leaves.
  await drain();

  return reply;
}
