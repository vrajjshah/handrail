/**
 * Which IP addresses a hosted scanner must refuse to reach.
 *
 * A scanner is an SSRF engine pointed at whatever a stranger types, and the
 * blast radius is everything the container can reach that the internet cannot:
 * the cloud metadata endpoint, the database, the queue, a colleague's laptop on
 * the same VPC.
 *
 * The list is written as an **allowlist of nothing** — every range that is not
 * ordinary public unicast is blocked, and a range nobody thought about lands in
 * the `else` that rejects. Deciding by exclusion is how these guards get holes.
 */

export type IpFamily = 'ipv4' | 'ipv6';

export interface BlockedIpReason {
  blocked: true;
  reason: string;
}

export type IpVerdict = BlockedIpReason | { blocked: false };

const ALLOWED = { blocked: false } as const;

function block(reason: string): BlockedIpReason {
  return { blocked: true, reason };
}

/** Parse a dotted-quad into its four octets, or `undefined` if it is not one. */
export function parseIpv4(value: string): [number, number, number, number] | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    // No leading zeros: `0177.0.0.1` is octal for 127.0.0.1 in some resolvers,
    // and a parser that accepted it here would disagree with the one that
    // eventually connects. Where two parsers can disagree, refuse the input.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    octets.push(octet);
  }
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/** Every IPv4 range a public scan target may not live in. */
export function checkIpv4(value: string): IpVerdict {
  const octets = parseIpv4(value);
  if (octets === undefined) return block(`${value} is not a valid IPv4 address`);
  const [a, b] = octets;

  if (a === 0) return block('0.0.0.0/8 is "this network"');
  if (a === 10) return block('10.0.0.0/8 is private');
  if (a === 127) return block('127.0.0.0/8 is loopback');
  if (a === 100 && b >= 64 && b <= 127) return block('100.64.0.0/10 is carrier-grade NAT');
  if (a === 169 && b === 254) {
    // 169.254.169.254 is the cloud metadata endpoint on AWS, GCP and Azure —
    // the single most valuable target an SSRF ever reaches. The whole /16 goes.
    return block('169.254.0.0/16 is link-local, and carries the cloud metadata endpoint');
  }
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return block('172.16.0.0/12 is private');
  if (a === 192 && b === 0) return block('192.0.0.0/24 is IETF protocol assignments');
  if (a === 192 && b === 168) return block('192.168.0.0/16 is private');
  if (a === 198 && b !== undefined && (b === 18 || b === 19)) {
    return block('198.18.0.0/15 is benchmarking');
  }
  if (a !== undefined && a >= 224) return block(`${value} is multicast or reserved`);

  return ALLOWED;
}

/** Expand an IPv6 address to its eight 16-bit groups, or `undefined`. */
export function parseIpv6(value: string): number[] | undefined {
  const address = value.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!address.includes(':')) return undefined;

  const [head, tail, ...rest] = address.split('::');
  if (rest.length > 0) return undefined;

  const parseGroups = (part: string): number[] | undefined => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const raw of part.split(':')) {
      // An embedded IPv4 tail (`::ffff:127.0.0.1`) becomes two groups.
      if (raw.includes('.')) {
        const octets = parseIpv4(raw);
        if (octets === undefined) return undefined;
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(raw)) return undefined;
      groups.push(Number.parseInt(raw, 16));
    }
    return groups;
  };

  const left = parseGroups(head ?? '');
  if (left === undefined) return undefined;

  if (tail === undefined) return left.length === 8 ? left : undefined;

  const right = parseGroups(tail);
  if (right === undefined) return undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

export function checkIpv6(value: string): IpVerdict {
  const groups = parseIpv6(value);
  if (groups === undefined) return block(`${value} is not a valid IPv6 address`);
  const [first, second] = groups;
  if (first === undefined || second === undefined) return block(`${value} is not a valid IPv6 address`);

  const isZeroPrefix = groups.slice(0, 7).every((group) => group === 0);
  if (isZeroPrefix && groups[7] === 1) return block('::1 is loopback');
  if (groups.every((group) => group === 0)) return block(':: is unspecified');

  // `::ffff:a.b.c.d` is an IPv4 address wearing a hat, and it is the standard
  // way to smuggle 127.0.0.1 past a guard that only looks at IPv6 prefixes.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const a = (groups[6] ?? 0) >> 8;
    const b = (groups[6] ?? 0) & 0xff;
    const c = (groups[7] ?? 0) >> 8;
    const d = (groups[7] ?? 0) & 0xff;
    const mapped = checkIpv4(`${String(a)}.${String(b)}.${String(c)}.${String(d)}`);
    if (mapped.blocked) return block(`IPv4-mapped ${value}: ${mapped.reason}`);
    return ALLOWED;
  }

  if ((first & 0xfe00) === 0xfc00) return block('fc00::/7 is unique-local');
  if ((first & 0xffc0) === 0xfe80) return block('fe80::/10 is link-local');
  if ((first & 0xff00) === 0xff00) return block('ff00::/8 is multicast');
  // 64:ff9b::/96 is NAT64 — it maps to an arbitrary IPv4 address, including a
  // private one, and the translation happens after we have stopped looking.
  if (first === 0x0064 && second === 0xff9b) return block('64:ff9b::/96 is NAT64');

  return ALLOWED;
}

/** The verdict on one resolved address, whichever family it belongs to. */
export function checkIp(value: string): IpVerdict {
  return value.includes(':') ? checkIpv6(value) : checkIpv4(value);
}

/**
 * True when a string is an address rather than a name.
 *
 * The distinction decides whether a host goes to the resolver or is judged
 * directly, so it has to be the same question both parsers answer — asking it
 * with a separate regex is how the two come to disagree.
 */
export function isIpLiteral(value: string): boolean {
  const bare = value.replace(/^\[|\]$/g, '');
  return bare.includes(':') ? parseIpv6(bare) !== undefined : parseIpv4(bare) !== undefined;
}

/** Convenience for the common question. */
export function isPublicIp(value: string): boolean {
  return !checkIp(value).blocked;
}

export function familyOf(value: string): IpFamily {
  return value.includes(':') ? 'ipv6' : 'ipv4';
}
