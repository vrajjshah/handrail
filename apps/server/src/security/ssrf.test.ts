import { describe, expect, it } from 'vitest';

import { checkIp, isIpLiteral, parseIpv4, parseIpv6 } from './ip.js';
import { SsrfBlockedError, assertSafeHop, assertSafeUrl, type FetchHead } from './ssrf.js';

/** A resolver that answers from a table, so no test touches DNS. */
const resolver = (table: Record<string, string[]>) => (hostname: string) => {
  const addresses = table[hostname];
  if (addresses === undefined) return Promise.reject(new Error(`no record for ${hostname}`));
  return Promise.resolve(addresses);
};

const publicHost = { 'example.com': ['93.184.216.34'] };

async function reasonFor(url: string, table: Record<string, string[]> = publicHost) {
  try {
    await assertSafeHop(url, { resolve: resolver(table) });
    return 'allowed';
  } catch (error) {
    if (error instanceof SsrfBlockedError) return error.reason;
    throw error;
  }
}

describe('parseIpv4', () => {
  it('reads a dotted quad', () => {
    expect(parseIpv4('93.184.216.34')).toEqual([93, 184, 216, 34]);
  });

  it('refuses a leading zero rather than guessing what it means', () => {
    // `0177.0.0.1` is octal for 127.0.0.1 to some resolvers. A parser that
    // accepted it here would disagree with the one that eventually connects,
    // and disagreement between two parsers is where these bypasses live.
    expect(parseIpv4('0177.0.0.1')).toBeUndefined();
    expect(parseIpv4('010.0.0.1')).toBeUndefined();
  });

  it.each(['1.2.3', '1.2.3.4.5', '256.1.1.1', '1.1.1.-1', '', 'example.com'])(
    'refuses %s',
    (value) => {
      expect(parseIpv4(value)).toBeUndefined();
    },
  );
});

describe('parseIpv6', () => {
  it('expands a compressed address', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('expands an IPv4-mapped tail', () => {
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it('refuses two compressions', () => {
    expect(parseIpv6('1::2::3')).toBeUndefined();
  });
});

describe('checkIp', () => {
  it('allows ordinary public unicast', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(checkIp(address).blocked, address).toBe(false);
    }
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'metadata'],
    ['169.254.0.1', 'link-local'],
    ['0.0.0.0', 'this network'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped'],
    ['::ffff:169.254.169.254', 'IPv4-mapped'],
    ['64:ff9b::1', 'NAT64'],
  ])('blocks %s', (address) => {
    expect(checkIp(address).blocked, address).toBe(true);
  });

  it('allows 172.32 and 172.15, which are outside the private /12', () => {
    // The classic off-by-one in a hand-written block list.
    expect(checkIp('172.15.0.1').blocked).toBe(false);
    expect(checkIp('172.32.0.1').blocked).toBe(false);
  });
});

describe('isIpLiteral', () => {
  it('separates addresses from names', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('0177.0.0.1')).toBe(false);
  });
});

describe('assertSafeHop', () => {
  it('allows an ordinary public URL', async () => {
    const url = await assertSafeHop('https://example.com/page', { resolve: resolver(publicHost) });
    expect(url.hostname).toBe('example.com');
  });

  // The acceptance criterion's named probes.
  it.each([
    ['http://localhost:8080/', 'blocked-hostname'],
    ['http://localhost./', 'blocked-hostname'],
    ['http://LOCALHOST/', 'blocked-hostname'],
    ['http://api.localhost/', 'blocked-hostname'],
    ['http://metadata.google.internal/', 'blocked-hostname'],
    ['http://127.0.0.1/', 'private-address'],
    ['http://127.0.0.1:5432/', 'private-address'],
    ['http://169.254.169.254/latest/meta-data/', 'private-address'],
    ['http://[::1]/', 'private-address'],
    ['http://[::ffff:127.0.0.1]/', 'private-address'],
    ['http://10.0.0.1/', 'private-address'],
    ['http://192.168.0.1/', 'private-address'],
  ])('rejects %s', async (url, reason) => {
    expect(await reasonFor(url)).toBe(reason);
  });

  it.each([
    ['file:///etc/passwd', 'blocked-scheme'],
    ['gopher://example.com/', 'blocked-scheme'],
    ['ftp://example.com/', 'blocked-scheme'],
    ['data:text/html,<script>', 'blocked-scheme'],
    ['not a url', 'invalid-url'],
  ])('rejects %s', async (url, reason) => {
    expect(await reasonFor(url)).toBe(reason);
  });

  it('rejects credentials in the URL', async () => {
    expect(await reasonFor('https://user:secret@example.com/')).toBe('credentials-in-url');
  });

  it('judges where a name points, not what it looks like', async () => {
    // The whole reason the guard resolves: `evil.test` is a perfectly ordinary
    // hostname whose A record is 127.0.0.1.
    expect(await reasonFor('https://evil.test/', { 'evil.test': ['127.0.0.1'] })).toBe(
      'private-address',
    );
  });

  it('rejects a name that resolves to a public *and* a private address', async () => {
    // One good record does not make it safe: the resolver answering the actual
    // connection may pick the other one, which is DNS rebinding in one step.
    expect(
      await reasonFor('https://mixed.test/', { 'mixed.test': ['93.184.216.34', '10.0.0.1'] }),
    ).toBe('private-address');
  });

  it('rejects a name that does not resolve at all', async () => {
    expect(await reasonFor('https://nowhere.test/', {})).toBe('unresolvable');
  });

  it('rejects a name with no records rather than treating the empty list as clean', async () => {
    expect(await reasonFor('https://empty.test/', { 'empty.test': [] })).toBe('unresolvable');
  });
});

describe('assertSafeUrl following redirects', () => {
  const head =
    (chain: Record<string, string>): FetchHead =>
    (url) =>
      Promise.resolve(
        chain[url] === undefined
          ? { status: 200, location: null }
          : { status: 302, location: chain[url] ?? null },
      );

  it('allows a chain that stays public', async () => {
    const result = await assertSafeUrl('https://example.com/', {
      resolve: resolver({ ...publicHost, 'www.example.com': ['93.184.216.34'] }),
      head: head({
        'https://example.com/': 'https://www.example.com/',
      }),
    });
    expect(result.finalUrl.toString()).toBe('https://www.example.com/');
    expect(result.chain).toHaveLength(2);
  });

  // The acceptance criterion: a redirect chain that lands on a private address.
  it('rejects a public URL that redirects to the metadata endpoint', async () => {
    await expect(
      assertSafeUrl('https://example.com/', {
        resolve: resolver(publicHost),
        head: head({ 'https://example.com/': 'http://169.254.169.254/latest/meta-data/' }),
      }),
    ).rejects.toMatchObject({ reason: 'private-address' });
  });

  it('rejects a private address reached three hops in', async () => {
    // A guard that only checks the first and last hop misses this.
    await expect(
      assertSafeUrl('https://example.com/', {
        resolve: resolver({
          ...publicHost,
          'a.test': ['93.184.216.34'],
          'b.test': ['93.184.216.34'],
        }),
        head: head({
          'https://example.com/': 'https://a.test/',
          'https://a.test/': 'https://b.test/',
          'https://b.test/': 'http://127.0.0.1/',
        }),
      }),
    ).rejects.toMatchObject({ reason: 'private-address' });
  });

  it('rejects a redirect that changes scheme to something unscannable', async () => {
    await expect(
      assertSafeUrl('https://example.com/', {
        resolve: resolver(publicHost),
        head: head({ 'https://example.com/': 'file:///etc/passwd' }),
      }),
    ).rejects.toMatchObject({ reason: 'blocked-scheme' });
  });

  it('resolves a relative Location against the hop it came from', async () => {
    const result = await assertSafeUrl('https://example.com/a', {
      resolve: resolver(publicHost),
      head: head({ 'https://example.com/a': '/b' }),
    });
    expect(result.finalUrl.toString()).toBe('https://example.com/b');
  });

  it('gives up on a redirect loop', async () => {
    await expect(
      assertSafeUrl('https://example.com/', {
        resolve: resolver(publicHost),
        head: head({ 'https://example.com/': 'https://example.com/' }),
      }),
    ).rejects.toMatchObject({ reason: 'too-many-redirects' });
  });

  it('does not treat a refused HEAD as unsafe', async () => {
    // Plenty of sites reject HEAD. What matters is that no unvalidated hop was
    // taken, not that the probe succeeded.
    const result = await assertSafeUrl('https://example.com/', {
      resolve: resolver(publicHost),
      head: () => Promise.reject(new Error('connection reset')),
    });
    expect(result.finalUrl.toString()).toBe('https://example.com/');
  });
});
