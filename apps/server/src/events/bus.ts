import type { ScanId } from '@handrail/schemas';

/**
 * "Something was appended for this scan."
 *
 * Note what a notification does **not** carry: the event. It is a nudge, and
 * the subscriber answers it by reading rows after the last `seq` it sent. That
 * is what makes the stream correct rather than merely live — a dropped
 * notification costs latency, not data, and a notification that arrives twice
 * reads the same empty range twice. Putting the payload in the notification
 * would make every delivery guarantee the notification's problem, and Postgres
 * `NOTIFY` is explicitly not a queue.
 */
export interface ScanEventBus {
  /** Announce that new events exist for a scan. */
  notify(scanId: ScanId): Promise<void>;
  /** Call `onChange` whenever this scan may have new events. Returns an unsubscribe. */
  subscribe(scanId: ScanId, onChange: () => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** An in-process bus. Correct whenever the API and the worker share a process. */
export class MemoryEventBus implements ScanEventBus {
  private readonly listeners = new Map<string, Set<() => void>>();

  notify(scanId: ScanId): Promise<void> {
    for (const listener of this.listeners.get(scanId) ?? []) listener();
    return Promise.resolve();
  }

  subscribe(scanId: ScanId, onChange: () => void): Promise<() => Promise<void>> {
    const existing = this.listeners.get(scanId) ?? new Set();
    existing.add(onChange);
    this.listeners.set(scanId, existing);

    return Promise.resolve(() => {
      const set = this.listeners.get(scanId);
      set?.delete(onChange);
      if (set?.size === 0) this.listeners.delete(scanId);
      return Promise.resolve();
    });
  }

  close(): Promise<void> {
    this.listeners.clear();
    return Promise.resolve();
  }

  /** Test seam: how many streams are attached. A leak shows up here first. */
  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}
