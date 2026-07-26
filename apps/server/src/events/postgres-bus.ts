import type { ScanId } from '@handrail/schemas';
import { Client, type Pool } from 'pg';

import type { ScanEventBus } from './bus.js';

/** One channel for every scan, filtered by payload. */
export const SCAN_EVENTS_CHANNEL = 'handrail_scan_events';

/**
 * `LISTEN`/`NOTIFY`, so the API learns about a worker's writes without polling.
 *
 * **One channel, not one per scan.** `LISTEN` is per-connection and its channel
 * names are not parameterisable, so a channel per scan means either a
 * connection per scan or string-built SQL on a value derived from a request.
 * One channel with the scan id as the payload costs a cheap fan-out in Node and
 * avoids both.
 *
 * The listening connection is a dedicated `Client`, never one borrowed from the
 * pool: a pooled connection is returned when the query finishes, and a `LISTEN`
 * on a connection that goes back into rotation is a subscription that silently
 * belongs to whoever gets it next.
 */
export class PostgresEventBus implements ScanEventBus {
  private readonly connectionString: string;
  private readonly pool: Pool;
  private readonly listeners = new Map<string, Set<() => void>>();
  private client: Client | undefined;
  private connecting: Promise<void> | undefined;
  private closed = false;

  constructor(options: { connectionString: string; pool: Pool }) {
    this.connectionString = options.connectionString;
    this.pool = options.pool;
  }

  private async ensureListening(): Promise<void> {
    if (this.client !== undefined || this.closed) return;
    this.connecting ??= (async () => {
      const client = new Client({ connectionString: this.connectionString });
      client.on('notification', (message) => {
        const scanId = message.payload;
        if (typeof scanId !== 'string') return;
        for (const listener of this.listeners.get(scanId) ?? []) listener();
      });
      // A dropped connection would otherwise take every live stream down with
      // it silently. Reconnecting is left to the next subscribe; the streams
      // that were open fall back to their own poll, which is why they have one.
      client.on('error', () => {
        this.client = undefined;
        this.connecting = undefined;
      });
      await client.connect();
      await client.query(`LISTEN ${SCAN_EVENTS_CHANNEL}`);
      this.client = client;
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async notify(scanId: ScanId): Promise<void> {
    // `pg_notify` rather than `NOTIFY <channel>, '<payload>'`: the function
    // form takes both as parameters, so nothing derived from a scan id is ever
    // concatenated into SQL.
    await this.pool.query('select pg_notify($1, $2)', [SCAN_EVENTS_CHANNEL, scanId]);
  }

  async subscribe(scanId: ScanId, onChange: () => void): Promise<() => Promise<void>> {
    await this.ensureListening();
    const existing = this.listeners.get(scanId) ?? new Set();
    existing.add(onChange);
    this.listeners.set(scanId, existing);

    return () => {
      const set = this.listeners.get(scanId);
      set?.delete(onChange);
      if (set?.size === 0) this.listeners.delete(scanId);
      return Promise.resolve();
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) await client.end();
  }
}
