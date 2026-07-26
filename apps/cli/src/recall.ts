import type { Finding } from '@handrail/schemas';

/** One planted defect, as `fixtures/apps/seeded-demo/ground-truth.json` records it. */
export interface GroundTruthDefect {
  id: string;
  sc: string[];
  scPrimary: string;
  severity: string;
  detectableBy: string[];
  expectedCheckIds?: string[];
}

export interface RecallRow {
  id: string;
  scPrimary: string;
  detectableBy: string[];
  found: boolean;
  /** The check that actually caught it, when one did. */
  foundBy?: string;
  tier?: string;
}

export interface RecallByClass {
  detectableBy: string;
  planted: number;
  found: number;
  recall: number;
}

export interface RecallBaseline {
  baselineVersion: 1;
  fixture: string;
  /** Recall over every planted defect, whatever layer was meant to catch it. */
  overall: { planted: number; found: number; recall: number };
  byDetectabilityClass: RecallByClass[];
  defects: RecallRow[];
  /** Traps that must NOT be flagged. A trap in here is a false positive. */
  trapsFlagged: string[];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Measure recall of the seeded defects, anchored by xpath.
 *
 * The fixture deliberately does **not** index its `data-gt` markers — a check
 * that could see them would be grading its own homework — so `anchors` maps each
 * ground-truth id to the xpath of the element it was planted on, and a defect
 * counts as found when some finding lands on that exact element.
 *
 * Traps are measured the same way and reported separately: a trap that gets
 * flagged is a false positive, and a recall number quoted without that figure
 * beside it is the kind of number this project exists not to publish.
 */
export function measureRecall(input: {
  fixture: string;
  defects: readonly GroundTruthDefect[];
  traps: readonly { id: string }[];
  anchors: Record<string, string>;
  findings: readonly Finding[];
}): RecallBaseline {
  const byXpath = new Map<string, Finding[]>();
  for (const finding of input.findings) {
    const xpath = finding.element?.xpath;
    if (xpath === undefined) continue;
    byXpath.set(xpath, [...(byXpath.get(xpath) ?? []), finding]);
  }

  const rows: RecallRow[] = input.defects.map((defect) => {
    const anchor = input.anchors[defect.id];
    const hits = anchor === undefined ? [] : (byXpath.get(anchor) ?? []);
    const hit = hits[0];
    return {
      id: defect.id,
      scPrimary: defect.scPrimary,
      detectableBy: defect.detectableBy,
      found: hit !== undefined,
      ...(hit === undefined ? {} : { foundBy: hit.checkId, tier: hit.tier }),
    };
  });

  const classes = [...new Set(input.defects.flatMap((defect) => defect.detectableBy))].sort();
  const byDetectabilityClass = classes.map((detectableBy) => {
    const planted = rows.filter((row) => row.detectableBy.includes(detectableBy));
    const found = planted.filter((row) => row.found);
    return {
      detectableBy,
      planted: planted.length,
      found: found.length,
      recall: planted.length === 0 ? 0 : round(found.length / planted.length),
    };
  });

  const foundRows = rows.filter((row) => row.found);

  return {
    baselineVersion: 1,
    fixture: input.fixture,
    overall: {
      planted: rows.length,
      found: foundRows.length,
      recall: rows.length === 0 ? 0 : round(foundRows.length / rows.length),
    },
    byDetectabilityClass,
    defects: rows,
    trapsFlagged: input.traps
      .filter((trap) => {
        const anchor = input.anchors[trap.id];
        return anchor !== undefined && (byXpath.get(anchor)?.length ?? 0) > 0;
      })
      .map((trap) => trap.id),
  };
}

export function serializeBaseline(baseline: RecallBaseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}
