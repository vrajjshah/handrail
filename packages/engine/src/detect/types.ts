import type { CheckId, Finding } from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { AxeNode, AxeResult } from './axe-types.js';

/** An axe node with its target resolved to an xpath in the page, or null. */
export type EnrichedAxeNode = AxeNode & { xpath: string | null };

export interface EnrichedAxeGroup {
  id: string;
  impact: AxeResult['violations'][number]['impact'];
  tags: string[];
  help: string;
  helpUrl: string;
  description: string;
  nodes: EnrichedAxeNode[];
}

/** The trimmed, xpath-enriched shape the browser runner returns. */
export interface EnrichedAxeResult {
  axeVersion: string;
  violations: EnrichedAxeGroup[];
  incomplete: EnrichedAxeGroup[];
  /** Passes are summarised, not carried whole — only the rule and how many nodes. */
  passes: { id: string; nodeCount: number }[];
}

/**
 * A rule that ran clean.
 *
 * Kept because a criterion can only be reported as `pass` on positive evidence,
 * and this is where that evidence comes from — but it is *carried*, not acted on.
 * Most axe checks are failure-detectors whose silence proves nothing (see the
 * coverage class in `@handrail/wcag`), so it is the scoring layer, not this one,
 * that decides whether a pass is sufficient. The detection layer's job is to
 * report the outcome faithfully, not to launder it into a verdict.
 */
export interface CriterionPassEvidence {
  ruleId: string;
  checkId: CheckId;
  sc: readonly KnownScId[];
  nodeCount: number;
}

export interface DetectionDegradation {
  reason: 'axe-version-mismatch' | 'axe-run-failed' | 'ungrounded-node';
  detail: string;
}

export interface AxeDetectionResult {
  findings: Finding[];
  /** Positive evidence for the scoring layer — not findings. */
  passes: CriterionPassEvidence[];
  degradations: DetectionDegradation[];
  axeVersion: string;
}
