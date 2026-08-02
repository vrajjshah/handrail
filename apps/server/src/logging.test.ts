import { Writable } from 'node:stream';

import { pino, type Logger } from 'pino';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  REDACTED_PATHS,
  correlationIdFrom,
  correlationIdFromUrl,
  loggerOptions,
  scrubUnloggable,
} from './logging.js';

/** Capture what actually reaches the transport, which is the only thing that matters. */
function capture(): { lines: Record<string, unknown>[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { lines, stream };
}

function logger(): { lines: Record<string, unknown>[]; log: Logger } {
  const { lines, stream } = capture();
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
  return { lines, log: pino(loggerOptions(config), stream) };
}

describe('scrubUnloggable', () => {
  it('replaces a Buffer with its size, whatever key it arrived under', () => {
    // By type, not by key name: the key that leaks a screenshot will be the one
    // nobody thought to add to the redaction list.
    const replaced = scrubUnloggable({
      surprise: Buffer.from('a screenshot of someone’s inbox'),
    }) as Record<string, string>;
    expect(replaced.surprise).toMatch(/^\[Buffer \d+ bytes\]$/);
  });

  it('reaches into nested objects and arrays', () => {
    const replaced = scrubUnloggable({
      evidence: [{ image: Buffer.from('png') }, { image: new Uint8Array([1, 2, 3]) }],
    }) as { evidence: { image: string }[] };
    expect(replaced.evidence[0]?.image).toContain('Buffer');
    expect(replaced.evidence[1]?.image).toContain('Uint8Array');
  });

  it('leaves a class instance intact rather than flattening it', () => {
    // This is the bug it was written after: recursing into every object
    // rebuilds it from its *own enumerable* properties, and Fastify's request
    // keeps `method` and `url` on the prototype. Every request log line came
    // out as a bare id, and an Error would have lost its stack the same way.
    class Request {
      readonly id = 'req-1';
      readonly #verb: string;
      constructor(verb: string) {
        this.#verb = verb;
      }
      // A prototype getter, which is what Fastify's request has and what a
      // naive deep-copy loses.
      get method(): string {
        return this.#verb;
      }
    }
    const replaced = scrubUnloggable(new Request('GET'));
    expect(replaced).toBeInstanceOf(Request);
    expect((replaced as Request).method).toBe('GET');

    const error = scrubUnloggable(new Error('boom'));
    expect(error).toBeInstanceOf(Error);
  });

  it('leaves ordinary values alone', () => {
    expect(scrubUnloggable({ n: 1, s: 'x', b: true, nil: null })).toEqual({
      n: 1,
      s: 'x',
      b: true,
      nil: null,
    });
  });

  it('redacts a presigned URL by recognising the signature, not the key', () => {
    // A presigned R2 URL is a bearer capability for a screenshot: whoever reads
    // it out of a log can fetch someone's inbox until it expires, with no
    // credential of their own. Matched on `X-Amz-Signature`, so it is caught
    // whatever key it arrived under and however it was capitalised.
    const url =
      'https://acct.r2.cloudflarestorage.com/bucket/artifacts/full_a1b2c3d4.png' +
      '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=deadbeefcafe';

    for (const shape of [
      { location: url },
      { anythingAtAll: url },
      { nested: { deep: [url] } },
    ]) {
      expect(JSON.stringify(scrubUnloggable(shape)), 'leaked a signature').not.toContain(
        'deadbeefcafe',
      );
    }

    expect(scrubUnloggable(url.replace('X-Amz-Signature', 'x-amz-signature'))).toBe(
      '[signed url redacted]',
    );
  });

  it('leaves an unsigned artifact URL alone', () => {
    // The stable path is not a capability and is worth having in a log line.
    const path = 'https://handrail.example/api/artifacts/full_a1b2c3d4';
    expect(scrubUnloggable({ href: path })).toEqual({ href: path });
  });
});

describe('the configured logger', () => {
  it('emits JSON with a level, a timestamp and the service name', () => {
    const { lines, log } = logger();
    log.info('hello');
    expect(lines[0]).toMatchObject({ level: 'info', msg: 'hello', service: 'handrail-server' });
    expect(typeof lines[0]?.time).toBe('string');
  });

  it('never writes screenshot bytes to a log line', () => {
    // Screenshots are pixels of arbitrary websites: a logged-in inbox, a
    // medical record, an address. They do not go in a log.
    const { lines, log } = logger();
    log.info({ screenshot: Buffer.from('PNG-ish bytes'), scanId: 'scan_1' }, 'captured');

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('PNG-ish bytes');
    expect(lines[0]?.scanId).toBe('scan_1');
  });

  it('redacts a screenshot under an unexpected key too', () => {
    const { lines, log } = logger();
    log.info({ somethingNobodyListed: Buffer.from('secret pixels') }, 'captured');
    expect(JSON.stringify(lines[0])).not.toContain('secret pixels');
  });

  it('redacts credentials and tokens', () => {
    const { lines, log } = logger();
    log.info(
      {
        req: { headers: { authorization: 'Bearer sk-live-123', cookie: 'session=abc' } },
        ADMIN_TOKEN: 'admin-secret',
        DATABASE_URL: 'postgresql://user:password@host/db',
      },
      'request',
    );

    const serialised = JSON.stringify(lines[0]);
    for (const secret of ['sk-live-123', 'session=abc', 'admin-secret', 'password@host']) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it('carries correlationId onto every line from a child logger', () => {
    // The plan's rule: one string ties a request, a job and a worker together.
    const { lines, log } = logger();
    const child = log.child({ correlationId: 'scan_9f1c' });
    child.info('phase started');
    child.warn('degraded');

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.correlationId).toBe('scan_9f1c');
  });

  it('never writes a signed URL to a log line, in the object or in the message', () => {
    const { lines, log } = logger();
    const url =
      'https://acct.r2.cloudflarestorage.com/b/artifacts/full_a1.png?X-Amz-Signature=deadbeefcafe';

    log.info({ signedUrl: url, scanId: 'scan_1' }, 'issued an artifact url');
    log.info(`redirecting to ${url}`);

    for (const line of lines) {
      expect(JSON.stringify(line), 'leaked a signature').not.toContain('deadbeefcafe');
    }
    expect(lines[0]?.scanId).toBe('scan_1');
  });

  it('lists the paths it redacts, so the list is reviewable', () => {
    expect(REDACTED_PATHS).toContain('req.headers.authorization');
    expect(REDACTED_PATHS).toContain('screenshot');
    expect(REDACTED_PATHS).toContain('ANTHROPIC_API_KEY');
    expect(REDACTED_PATHS).toContain('R2_SECRET_ACCESS_KEY');
  });
});

describe('correlationIdFromUrl', () => {
  it.each([
    ['/api/scans/scan_9f1c', 'scan_9f1c'],
    ['/api/scans/scan_9f1c/events', 'scan_9f1c'],
    ['/api/scans/scan_9f1c/report.sarif', 'scan_9f1c'],
    ['/api/scans/scan_9f1c/events?lastEventId=4', 'scan_9f1c'],
  ])('reads %s', (url, expected) => {
    expect(correlationIdFromUrl(url)).toBe(expected);
  });

  it.each(['/api/meta', '/healthz', '/api/scans', '/api/artifacts/full_a1b2c3d4', undefined])(
    'has nothing to correlate for %s',
    (url) => {
      expect(correlationIdFromUrl(url)).toBeUndefined();
    },
  );

  it('does not read an unbounded string out of a hostile path', () => {
    expect(correlationIdFromUrl(`/api/scans/scan_${'a'.repeat(500)}`)).toBeUndefined();
  });
});

describe('correlationIdFrom', () => {
  it('takes the scan id from route params', () => {
    expect(correlationIdFrom({ id: 'scan_9f1c' })).toBe('scan_9f1c');
  });

  it('ignores an id that is not a scan id', () => {
    // `/api/artifacts/:id` has an `id` too, and it is not a correlation id.
    expect(correlationIdFrom({ id: 'full_a1b2c3d4' })).toBeUndefined();
    expect(correlationIdFrom({})).toBeUndefined();
    expect(correlationIdFrom(null)).toBeUndefined();
    expect(correlationIdFrom('scan_1')).toBeUndefined();
  });
});
