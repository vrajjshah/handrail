/**
 * The slice of axe-core's result shape this layer consumes.
 *
 * Declared structurally rather than imported from `axe-core`'s types: axe runs
 * *in the page*, and the result crosses the CDP boundary as plain JSON, so what
 * we receive in Node is a data shape, not an axe object. Typing only the fields
 * we use also documents exactly what the mapper depends on.
 */

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical' | null;

/** One check's data within a node — carries the measured values axe computed. */
export interface AxeCheckResult {
  id: string;
  message: string;
  data?: unknown;
}

export interface AxeNode {
  html: string;
  target: string[];
  impact: AxeImpact;
  // `?:` alone would forbid an explicit `undefined` under exactOptionalPropertyTypes,
  // and the trimming in the runner reads it straight off axe where it may be absent.
  failureSummary?: string | undefined;
  any: AxeCheckResult[];
  all: AxeCheckResult[];
  none: AxeCheckResult[];
}

export interface AxeResultGroup {
  id: string;
  impact: AxeImpact;
  tags: string[];
  help: string;
  helpUrl: string;
  description: string;
  nodes: AxeNode[];
}

export interface AxeResult {
  testEngine: { name: string; version: string };
  violations: AxeResultGroup[];
  incomplete: AxeResultGroup[];
  passes: AxeResultGroup[];
  inapplicable: AxeResultGroup[];
}

/** The measured data axe attaches to a `color-contrast` check. */
export interface AxeContrastData {
  fgColor: string;
  bgColor: string;
  contrastRatio: number;
  expectedContrastRatio: string;
  fontSize: string;
  fontWeight: string;
}

export function isContrastData(data: unknown): data is AxeContrastData {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as AxeContrastData).contrastRatio === 'number' &&
    typeof (data as AxeContrastData).expectedContrastRatio === 'string'
  );
}
