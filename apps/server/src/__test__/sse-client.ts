import type { ScanEvent } from '@handrail/schemas';

/**
 * A minimal SSE reader, so the replay tests exercise a real socket.
 *
 * `app.inject()` buffers a whole response and waits for it to end, which is
 * exactly what a live stream never does. The property under test is what a
 * client sees *while* the scan runs and what it is handed after it reconnects,
 * and neither is observable without an actual connection.
 */
export interface SseFrame {
  id: number | undefined;
  event: string | undefined;
  data: ScanEvent | undefined;
}

export interface SseSession {
  frames: SseFrame[];
  /** Every event received, in arrival order. */
  events: ScanEvent[];
  status: number;
  /** Stop reading and drop the connection, the way a closed tab does. */
  close: () => void;
  /** Resolves when the server ends the stream. */
  done: Promise<void>;
}

/** Open a stream. `lastEventId` is sent the way a reconnecting client would. */
export async function openSse(
  url: string,
  options: { lastEventId?: number } = {},
): Promise<SseSession> {
  const controller = new AbortController();
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      accept: 'text/event-stream',
      ...(options.lastEventId === undefined
        ? {}
        : { 'last-event-id': String(options.lastEventId) }),
    },
  });

  const session: SseSession = {
    frames: [],
    events: [],
    status: response.status,
    close: () => controller.abort(),
    done: Promise.resolve(),
  };

  if (response.body === null || response.status !== 200) return session;

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  session.done = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = parseFrame(raw);
          if (frame !== undefined) {
            session.frames.push(frame);
            if (frame.data !== undefined) session.events.push(frame.data);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // An aborted read is how this client disconnects on purpose.
    }
  })();

  return session;
}

function parseFrame(raw: string): SseFrame | undefined {
  // Comments (`: keep-alive`) and `retry:` are not events.
  if (raw.startsWith(':')) return undefined;

  let id: number | undefined;
  let event: string | undefined;
  let data: ScanEvent | undefined;

  for (const line of raw.split('\n')) {
    if (line.startsWith('id: ')) id = Number(line.slice(4));
    else if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) data = JSON.parse(line.slice(6)) as ScanEvent;
  }

  if (id === undefined && data === undefined) return undefined;
  return { id, event, data };
}

/** Wait for a condition, or fail loudly rather than hanging the suite. */
export async function until(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}
