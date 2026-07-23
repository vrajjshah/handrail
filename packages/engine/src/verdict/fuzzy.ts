/**
 * Whitespace-normalised comparison form.
 *
 * Markup a model quotes back is almost never byte-identical to the snapshot —
 * attribute order survives, but indentation, line breaks and the exact run of
 * spaces between attributes do not. Normalising those away is the difference
 * between a 90% threshold that measures *fidelity* and one that measures
 * *pretty-printing*.
 */
export function normalizeMarkup(value: string): string {
  return (
    value
      .replace(/\s+/g, ' ')
      // Whitespace hugging a tag delimiter is pretty-printing, and a model that
      // quotes `<a href="/menu">Click here</a>` from a page whose serialiser
      // wrote `<a href="/menu">\n  Click here\n</a>` has quoted it correctly.
      //
      // ` ?` and not `\s*`: the obvious `/\s*([<>])\s*/g` is *polynomial* on a
      // long whitespace run, because the engine retries `\s*` from every
      // position inside it — 1.6s for 60k spaces, and this runs over a whole
      // captured DOM snapshot, which is attacker-controlled. Collapsing first
      // happens to defuse it, but that would make the safety an accident of
      // ordering that nothing at the call site can see. Each step is linear on
      // its own instead. CodeQL caught this one.
      .replace(/ ?([<>]) ?/g, '$1')
      .trim()
      .toLowerCase()
  );
}

/**
 * Levenshtein distance, bounded by `max`.
 *
 * Returns `max + 1` as soon as every cell in a row exceeds the bound, so a quote
 * that is nowhere near the snapshot costs a few rows rather than a full matrix.
 * That matters: this runs against every candidate on every page.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      const best = Math.min(substitution, deletion, insertion);
      current[j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }

  return previous[b.length]!;
}

/** Similarity in [0, 1]: 1 is identical, 0 is nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const distance = boundedLevenshtein(a, b, longest);
  return 1 - distance / longest;
}

/** Comparing a quote against every window of a large snapshot has to stay bounded. */
const MAX_WINDOW_PROBES = 200;
const MAX_QUOTE_LENGTH = 600;

/**
 * How well a quoted fragment matches somewhere inside a haystack.
 *
 * Exact containment short-circuits to 1 — the common case, since a model asked
 * to quote usually can. Otherwise the search is *anchored*: windows are probed
 * only where the quote's opening token actually occurs in the haystack, capped
 * at {@link MAX_WINDOW_PROBES}. A full sliding window over a 200KB DOM snapshot
 * would be minutes of Levenshtein per candidate, and the un-anchored windows it
 * would visit are exactly the ones that cannot match.
 */
export function bestMatchRatio(quote: string, haystack: string): number {
  const needle = normalizeMarkup(quote).slice(0, MAX_QUOTE_LENGTH);
  const hay = normalizeMarkup(haystack);
  if (needle.length === 0) return 0;
  if (hay.includes(needle)) return 1;

  // Anchor on the opening token — `<a`, `<img`, or the first word of a text
  // quote — which is the part a model reproduces correctly even when it
  // paraphrases the rest.
  const anchorMatch = /^<\/?[a-z0-9-]+|^[^\s]+/.exec(needle);
  const anchor = anchorMatch?.[0] ?? needle.slice(0, 4);

  let best = 0;
  let from = 0;
  for (let probe = 0; probe < MAX_WINDOW_PROBES; probe += 1) {
    const at = hay.indexOf(anchor, from);
    if (at === -1) break;
    const window = hay.slice(at, at + needle.length);
    const ratio = similarity(needle, window);
    if (ratio > best) best = ratio;
    if (best === 1) break;
    from = at + 1;
  }

  return best;
}
