import type { Report, ScanEvent } from '@handrail/schemas';

/**
 * Fields whose value changes on every run without the behaviour changing.
 *
 * Each is replaced by a constant rather than deleted: a golden that silently
 * *loses* a key when a normaliser stops recognising it would hide exactly the
 * shape drift this snapshot exists to catch. A placeholder keeps the key, and
 * its presence, under review.
 */
const VOLATILE_KEYS = new Set([
  'ts',
  'at',
  'createdAt',
  'startedAt',
  'finishedAt',
  'generatedAt',
  'recordedAt',
  'durationMs',
  'latencyMs',
  'wallClockMs',
]);

/** Ids minted per run. Deterministic ids (finding ids are a content hash) are kept. */
const VOLATILE_ID_KEYS = new Set(['scanId', 'correlationId', 'artifactId', 'id']);

const PLACEHOLDER = '<normalised>';

/** Keys whose value is a filesystem path — absolute, therefore machine-specific. */
const PATH_KEYS = new Set(['path', 'outputDir', 'reportPath', 'artifactDir']);

/**
 * Geometry inside a `bbox`, which is host-specific.
 *
 * Chromium lays text out using the host's font rasterisation, so the same page
 * measures a pixel or two differently on macOS and on the Linux CI runner —
 * observed as `height: 19` vs `17`, `width: 54.73` vs `49.77`. Asserting these
 * would make this gate a font-version detector rather than a drift detector, and
 * would force every re-record onto Linux even though the developer works on a
 * Mac. The `bbox` key itself is kept, so a bounding box *disappearing* still
 * shows up as a diff — it is the coordinates, not the presence, that are noise.
 */
const BBOX_GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Scrub anything that identifies *this* run rather than *this behaviour*.
 *
 * `keyPath` is threaded through so a key can be judged in context: `id` is
 * volatile on a scan record but is a stable content hash on a finding, and
 * flattening that distinction would either churn the golden every run or blind
 * it to findings changing identity.
 */
function normalizeValue(value: unknown, key: string, parentKey: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, key, parentKey));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const childKey of Object.keys(value).sort()) {
      out[childKey] = normalizeValue(value[childKey], childKey, key);
    }
    return out;
  }

  if (typeof value !== 'string' && typeof value !== 'number') return value;

  if (VOLATILE_KEYS.has(key)) return PLACEHOLDER;

  if (parentKey === 'bbox' && BBOX_GEOMETRY_KEYS.has(key)) return PLACEHOLDER;

  // A finding's `id` is a sha256 of (pageStateId, checkId, xpath) — stable, and
  // worth diffing. A scan's is a per-run uuid. Same key, opposite meaning.
  if (VOLATILE_ID_KEYS.has(key) && !(key === 'id' && parentKey === 'findings')) {
    return PLACEHOLDER;
  }

  if (typeof value === 'string') {
    if (PATH_KEYS.has(key)) return PLACEHOLDER;
    // Absolute paths leak the checkout directory into the golden.
    if (/^(?:\/|[A-Za-z]:\\)/.test(value)) return PLACEHOLDER;
  }

  return value;
}

function normalize(value: unknown): unknown {
  return normalizeValue(value, '', '');
}

/**
 * The event stream, reduced to what a reviewer should have to approve.
 *
 * Payloads are dropped and only the *shape* is kept — the type, and for the
 * events that carry one, the phase or check. Node order and event sequence are
 * what this half of the golden is for; the report half covers content. Keeping
 * full payloads here would make the file churn on every wording change and stop
 * anyone from reading the diff, which is the failure mode that makes teams
 * rubber-stamp golden updates.
 */
export function normalizeEvents(events: readonly ScanEvent[]): unknown[] {
  return events.map((event) => {
    const base: Record<string, unknown> = { type: event.type };
    if ('phase' in event && event.phase !== undefined) base.phase = event.phase;
    if (event.type === 'finding.detected') {
      base.checkId = event.finding.checkId;
      base.tier = event.finding.tier;
      base.scPrimary = event.finding.scPrimary;
    }
    if (event.type === 'scan.degraded') base.reason = event.degradation.reason;
    if (event.type === 'log') base.level = event.level;
    if (event.type === 'scan.completed') base.findingsTotal = event.findingsTotal;
    return base;
  });
}

/** The report with per-run identity scrubbed, keys sorted, ready to diff. */
export function normalizeReport(report: Report): unknown {
  return normalize(report);
}

export interface GoldenSnapshot {
  events: unknown[];
  report: unknown;
}

export function buildSnapshot(events: readonly ScanEvent[], report: Report): GoldenSnapshot {
  return { events: normalizeEvents(events), report: normalizeReport(report) };
}

export function serializeSnapshot(snapshot: GoldenSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * A line diff a human can act on.
 *
 * The whole value of a golden is that a reviewer reads the diff and decides
 * whether the change was intended, so "snapshot mismatch" alone would make the
 * gate useless. Context is trimmed to the lines that differ, with line numbers.
 */
export function describeDiff(expected: string, actual: string, limit = 40): string {
  const want = expected.split('\n');
  const got = actual.split('\n');
  const lines: string[] = [];

  for (let index = 0; index < Math.max(want.length, got.length); index += 1) {
    const a = want[index];
    const b = got[index];
    if (a === b) continue;
    if (lines.length >= limit) {
      lines.push(`  … and more (showing the first ${String(limit)} differing lines)`);
      break;
    }
    if (a !== undefined) lines.push(`  -${String(index + 1).padStart(5)} ${a.trim()}`);
    if (b !== undefined) lines.push(`  +${String(index + 1).padStart(5)} ${b.trim()}`);
  }

  return lines.join('\n');
}
