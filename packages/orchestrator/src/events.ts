import {
  type ScanEvent,
  ScanEventSchema,
  type ScanId,
  isTerminalEvent,
} from '@handrail/schemas';

/** `Omit` that keeps a discriminated union discriminated. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An event as a node writes it: everything except the three fields the scan owns.
 *
 * `scanId`, `seq` and `ts` are stamped by {@link ScanEventEmitter} precisely so a
 * node cannot get them wrong — a node that could mint its own `seq` could mint a
 * duplicate one, and `seq` doubles as the SSE event id.
 */
export type ScanEventBody = DistributiveOmit<ScanEvent, 'scanId' | 'seq' | 'ts'>;

/** Where an emitted event goes. In a node this is LangGraph's custom-stream writer. */
export type ScanEventSink = (event: ScanEvent) => void;

export interface ScanEventEmitterOptions {
  scanId: ScanId;
  /** Clock seam, so a golden-scan run can be made deterministic. */
  now?: () => Date;
}

/**
 * The scan's event pen. It owns `seq`, and it is the only thing that does.
 *
 * `seq` is monotonic per scan and doubles as the SSE event id, which is what
 * makes replay-after-reconnect exact rather than approximate. That only holds if
 * exactly one counter mints it, so the packages below the orchestrator
 * deliberately have no way to: `CostLedger` hands a finished `ModelInvocation`
 * to `onInvocation` and lets this class decide where it lands in the stream.
 *
 * Every event is parsed through `ScanEventSchema` on the way out, so an invalid
 * event is a throw at the emitting node rather than a surprise in a consumer.
 *
 * **The sink is mutable and the graph runs one node at a time.** Each node
 * binds its own writer on entry ({@link useSink}). A parallel fan-out — `Send`,
 * when the crawler grows one — would interleave two nodes against one sink and
 * would need a writer per task instead.
 */
export class ScanEventEmitter {
  readonly scanId: ScanId;
  private readonly now: () => Date;
  private nextSeq = 0;
  private sink: ScanEventSink | undefined;

  constructor(options: ScanEventEmitterOptions) {
    this.scanId = options.scanId;
    this.now = options.now ?? (() => new Date());
  }

  /** The `seq` the next event will carry. */
  get seq(): number {
    return this.nextSeq;
  }

  /** Point the emitter at the writer of the node that is about to run. */
  useSink(sink: ScanEventSink | undefined): void {
    this.sink = sink;
  }

  /**
   * Stamp, validate and write one event. Returns it, so a caller emitting
   * outside a node (a terminal `scan.failed`, say) can still yield exactly what
   * was minted.
   */
  emit(body: ScanEventBody): ScanEvent {
    const event = ScanEventSchema.parse({
      ...body,
      scanId: this.scanId,
      seq: this.nextSeq,
      ts: this.now().toISOString(),
    });
    this.nextSeq += 1;
    this.sink?.(event);
    return event;
  }
}

/**
 * True when `events` is a well-ordered stream for one scan: one scan id,
 * `seq` starting at 0 and rising by exactly one, timestamps non-decreasing, and
 * a terminal event last or not at all.
 *
 * Exported because "the event stream is well-ordered" is an acceptance
 * criterion, and an acceptance criterion that only lives in a test file cannot
 * be asserted by the CLI, the SSE endpoint or the golden scan.
 */
export function checkEventStream(events: readonly ScanEvent[]): string[] {
  const problems: string[] = [];
  let previousTs = '';

  for (const [index, event] of events.entries()) {
    if (event.seq !== index) {
      problems.push(`event ${String(index)} has seq ${String(event.seq)}; expected ${String(index)}`);
    }
    if (index > 0 && event.scanId !== events[0]?.scanId) {
      problems.push(`event ${String(index)} belongs to a different scan`);
    }
    if (event.ts < previousTs) {
      problems.push(`event ${String(index)} goes back in time (${event.ts} < ${previousTs})`);
    }
    previousTs = event.ts;
    if (isTerminalEvent(event) && index !== events.length - 1) {
      problems.push(`terminal ${event.type} at ${String(index)} is followed by more events`);
    }
  }

  return problems;
}
