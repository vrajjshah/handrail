import { lookup } from 'node:dns/promises';

import { checkIp, isIpLiteral } from './ip.js';

/**
 * The SSRF guard.
 *
 * The threat is not hypothetical and not exotic: a stranger types a URL, and a
 * server with a browser and network access goes and fetches it. Everything the
 * container can reach that the internet cannot is in range — the metadata
 * endpoint, Postgres, the queue, the rest of the VPC.
 *
 * Four rules, in this order:
 *
 * 1. **Scheme allowlist.** `http` and `https`. Not `file:`, not `gopher:`, not
 *    anything a redirect might introduce.
 * 2. **No credentials in the URL**, which exist only to be replayed somewhere.
 * 3. **Resolve, then judge the addresses.** A hostname says nothing —
 *    `evil.test` can have an A record of `127.0.0.1`. What matters is where it
 *    points, and *every* address it points to, because a resolver may hand a
 *    different one to whoever connects next.
 * 4. **Re-check after every redirect.** A public URL that 302s to
 *    `169.254.169.254` is the standard bypass, and a guard that only looks at
 *    what the user typed does not see it.
 */
export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames refused before any resolver is consulted. */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export type SsrfReason =
  | 'invalid-url'
  | 'blocked-scheme'
  | 'credentials-in-url'
  | 'blocked-hostname'
  | 'unresolvable'
  | 'private-address'
  | 'too-many-redirects';

export class SsrfBlockedError extends Error {
  readonly reason: SsrfReason;
  /** The hop that failed, which is not always the URL the user submitted. */
  readonly url: string;

  constructor(reason: SsrfReason, url: string, detail: string) {
    super(detail);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
    this.url = url;
  }
}

/** Injected so the tests never touch a real resolver — and so #20 can stub it. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export const systemResolver: ResolveHost = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
};

/** Follows redirects itself, so each hop can be judged before the next is taken. */
export type FetchHead = (url: string) => Promise<{ status: number; location: string | null }>;

export const systemHead: FetchHead = async (url) => {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    // A hop check is not a page load. Anything slower than this is a target
    // that will time out during the scan anyway.
    signal: AbortSignal.timeout(5_000),
    headers: { 'user-agent': 'Handrail/0.1 (+https://github.com/vrajjshah/handrail)' },
  });
  return { status: response.status, location: response.headers.get('location') };
};

export interface GuardOptions {
  resolve?: ResolveHost;
  head?: FetchHead;
  /** Enough for a canonicalising CDN, few enough to bound the work. */
  maxRedirects?: number;
}

/**
 * Check one URL: scheme, credentials, hostname, and every address it resolves
 * to. No redirects — {@link assertSafeUrl} handles those.
 */
export async function assertSafeHop(rawUrl: string, options: GuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('invalid-url', rawUrl, 'That does not parse as a URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(
      'blocked-scheme',
      rawUrl,
      `Only http and https can be scanned; ${url.protocol} cannot.`,
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new SsrfBlockedError(
      'credentials-in-url',
      rawUrl,
      'Remove the credentials from the URL. Handrail will not replay them anywhere.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new SsrfBlockedError(
      'blocked-hostname',
      rawUrl,
      `${hostname} is not a public host. Handrail only scans addresses reachable from the internet.`,
    );
  }

  // A literal address skips the resolver but not the judgement. Whether it *is*
  // a literal is decided by the same parsers that judge it, so the two cannot
  // disagree about what `0177.0.0.1` or `::ffff:127.0.0.1` is.
  if (isIpLiteral(hostname)) {
    const literal = checkIp(hostname.replace(/^\[|\]$/g, ''));
    if (literal.blocked) {
      throw new SsrfBlockedError('private-address', rawUrl, `${hostname}: ${literal.reason}`);
    }
    return url;
  }

  const resolve = options.resolve ?? systemResolver;
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new SsrfBlockedError('unresolvable', rawUrl, `${hostname} does not resolve.`);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError('unresolvable', rawUrl, `${hostname} does not resolve.`);
  }

  // *Every* address, not the first. A hostname with one public A record and one
  // private one is a rebind waiting to happen, and the resolver that answers
  // the actual connection may pick differently than this one did.
  for (const address of addresses) {
    const verdict = checkIp(address);
    if (verdict.blocked) {
      throw new SsrfBlockedError(
        'private-address',
        rawUrl,
        `${hostname} resolves to ${address}, and ${verdict.reason}.`,
      );
    }
  }

  return url;
}

export interface SafeUrlResult {
  /** The address the scan should actually load, after redirects. */
  finalUrl: URL;
  /** Every hop, in order, including the submitted URL. */
  chain: string[];
}

/**
 * Validate a URL and every redirect it leads to.
 *
 * Redirects are followed **manually**, one hop at a time, so each new location
 * goes through the same guard as the first. `fetch(..., { redirect: 'follow' })`
 * would do the hops itself and hand back only the destination — by which point
 * the request to the private address has already been made, which is the entire
 * thing being prevented.
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: GuardOptions = {},
): Promise<SafeUrlResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const head = options.head ?? systemHead;

  let current = await assertSafeHop(rawUrl, options);
  const chain = [current.toString()];

  for (let hop = 0; hop < maxRedirects; hop += 1) {
    let response: { status: number; location: string | null };
    try {
      response = await head(current.toString());
    } catch {
      // The target refused a HEAD, or timed out. That is not evidence of
      // anything unsafe — plenty of sites reject HEAD — and the scan will find
      // out for itself. What matters is that no *unvalidated* hop was taken.
      return { finalUrl: current, chain };
    }

    if (response.status < 300 || response.status > 399 || response.location === null) {
      return { finalUrl: current, chain };
    }

    const next = new URL(response.location, current);
    current = await assertSafeHop(next.toString(), options);
    chain.push(current.toString());
  }

  throw new SsrfBlockedError(
    'too-many-redirects',
    rawUrl,
    `That URL redirects more than ${String(maxRedirects)} times.`,
  );
}
