import { createHash } from 'node:crypto';

import {
  FindingSchema,
  findingId,
  type CheckId,
  type Evidence,
  type Finding,
  type FindingInput,
  type ScId,
  type Severity,
} from '@handrail/schemas';
import { AXE_MAP, criteriaForAxeRule, type KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../capture/types.js';
import { isContrastData, type AxeImpact } from './axe-types.js';
import type {
  AxeDetectionResult,
  CriterionPassEvidence,
  DetectionDegradation,
  EnrichedAxeGroup,
  EnrichedAxeNode,
  EnrichedAxeResult,
} from './types.js';

const MAX_TOOL_OUTPUT = 8000;
const MAX_DOM_EXCERPT = 4000;

/** axe's impact maps directly onto our severity; a null impact defaults to moderate. */
function severityFor(impact: AxeImpact): Severity {
  return impact ?? 'moderate';
}

/** The most specific message axe attached to a node, across its check buckets. */
function messageFor(node: EnrichedAxeNode): string {
  for (const bucket of [node.none, node.all, node.any]) {
    const withMessage = bucket.find((check) => check.message.trim().length > 0);
    if (withMessage !== undefined) return withMessage.message;
  }
  return node.failureSummary ?? '';
}

/** Turns axe's measured contrast data into deterministic pixel evidence. */
function contrastEvidence(node: EnrichedAxeNode): Evidence | undefined {
  const contrastCheck = node.any.find((check) => check.id === 'color-contrast');
  if (contrastCheck === undefined || !isContrastData(contrastCheck.data)) return undefined;

  const { contrastRatio, expectedContrastRatio } = contrastCheck.data;
  const threshold = Number.parseFloat(expectedContrastRatio);
  if (Number.isNaN(threshold)) return undefined;

  return {
    kind: 'pixels',
    metric: 'contrast-ratio',
    measured: contrastRatio,
    threshold,
    comparator: 'gte',
  };
}

/**
 * A stable finding id.
 *
 * Deterministic — derived from the state, rule and element — so that the same
 * page produces the same ids on every scan. That is what lets the golden-scan
 * snapshot diff mean something and the judgment cache hit on a re-scan.
 */
function deterministicFindingId(pageStateId: string, ruleId: string, anchor: string): string {
  const digest = createHash('sha256').update(`${pageStateId}|${ruleId}|${anchor}`).digest('hex');
  return `find_${digest.slice(0, 16)}`;
}

function buildEvidence(node: EnrichedAxeNode, ruleId: string): Evidence[] {
  const evidence: Evidence[] = [
    {
      kind: 'tool',
      tool: 'axe-core',
      ruleId,
      output: messageFor(node).slice(0, MAX_TOOL_OUTPUT) || `axe rule ${ruleId} failed`,
    },
    {
      kind: 'dom',
      excerpt: node.html.slice(0, MAX_DOM_EXCERPT),
      selector: node.target.join(' '),
    },
  ];

  const contrast = contrastEvidence(node);
  if (contrast !== undefined) evidence.push(contrast);

  return evidence;
}

function elementFor(
  node: EnrichedAxeNode,
  byXpath: ReadonlyMap<string, ElementRecord>,
): FindingInput['element'] {
  const selector = node.target.join(' ') || 'unknown';
  const record = node.xpath !== null ? byXpath.get(node.xpath) : undefined;

  if (record === undefined) {
    return { selector, domExcerpt: node.html.slice(0, MAX_DOM_EXCERPT) };
  }

  return {
    elementId: record.elemId,
    selector: record.selector,
    xpath: record.xpath,
    domExcerpt: node.html.slice(0, MAX_DOM_EXCERPT),
    ...(record.bbox !== null ? { bbox: record.bbox } : {}),
    ...(record.accessibleName !== null ? { accessibleName: record.accessibleName } : {}),
    ...(record.role !== null ? { role: record.role } : {}),
  };
}

function findingsFromGroup(
  group: EnrichedAxeGroup,
  criteria: readonly KnownScId[],
  tier: 'violation' | 'needs-review',
  capture: StateCapture,
  byXpath: ReadonlyMap<string, ElementRecord>,
  degradations: DetectionDegradation[],
): Finding[] {
  const checkId: CheckId = `axe.${group.id}`;
  const sc = criteria as unknown as ScId[];
  const scPrimary = criteria[0] as unknown as ScId;

  return group.nodes.map((node) => {
    if (node.xpath === null) {
      degradations.push({
        reason: 'ungrounded-node',
        detail: `axe rule ${group.id} matched ${node.target.join(' ')} but it could not be resolved to an indexed element`,
      });
    }

    const anchor = node.xpath ?? node.target.join(' ');
    const input: FindingInput = {
      id: findingId(deterministicFindingId(capture.pageStateId, group.id, anchor)),
      checkId,
      source: 'axe',
      sc,
      scPrimary,
      tier,
      severity: severityFor(group.impact),
      // axe is deterministic; the verdict pipeline (a later stage) may still
      // re-check, but the detection itself is certain.
      confidence: 1,
      evidence: buildEvidence(node, group.id),
      element: elementFor(node, byXpath),
      page: {
        url: capture.url,
        pageStateId: capture.pageStateId,
        viewport: capture.viewport.label,
      },
      verification: { method: 'none', status: 'unverified' },
      description: messageFor(node) || group.help,
    };

    return FindingSchema.parse(input);
  });
}

/**
 * Maps an axe run over a captured state into findings and pass evidence.
 *
 * Pure and deterministic — no browser, no I/O — so the mapping is unit-testable
 * on every platform, and only the run that produced `result` needs a real
 * Chromium.
 *
 * Three rules encode the plan's honesty requirements:
 *
 * - **Violations become `violation`-tier findings** with tool evidence. That is
 *   sound because they carry deterministic evidence, which the schema's tier
 *   matrix requires for that tier.
 * - **`incomplete` results become `needs-review`.** axe could not decide, so
 *   neither do we — surfaced for a human rather than dropped.
 * - **A rule that maps to no criterion in our A/AA target is skipped**, not
 *   reported against something adjacent. Best-practice rules, AAA-only rules and
 *   the obsolete 4.1.1 duplicate-id rules all fall out here.
 */
export function mapAxeResult(result: EnrichedAxeResult, capture: StateCapture): AxeDetectionResult {
  const degradations: DetectionDegradation[] = [];

  // A mismatch means axe was injected at a version our committed rule map was not
  // built from, so an attribution could be wrong. Report it rather than trust it.
  if (result.axeVersion !== AXE_MAP.stamp.axeVersion) {
    degradations.push({
      reason: 'axe-version-mismatch',
      detail: `ran axe ${result.axeVersion} but the rule map was built from ${AXE_MAP.stamp.axeVersion}`,
    });
  }

  const byXpath = new Map(capture.elements.map((el) => [el.xpath, el]));
  const findings: Finding[] = [];

  for (const group of result.violations) {
    const criteria = criteriaForAxeRule(group.id);
    if (criteria.length === 0) continue;
    findings.push(...findingsFromGroup(group, criteria, 'violation', capture, byXpath, degradations));
  }

  for (const group of result.incomplete) {
    const criteria = criteriaForAxeRule(group.id);
    if (criteria.length === 0) continue;
    findings.push(
      ...findingsFromGroup(group, criteria, 'needs-review', capture, byXpath, degradations),
    );
  }

  const passes: CriterionPassEvidence[] = [];
  for (const pass of result.passes) {
    const criteria = criteriaForAxeRule(pass.id);
    if (criteria.length === 0) continue;
    passes.push({
      ruleId: pass.id,
      checkId: `axe.${pass.id}` satisfies CheckId,
      sc: criteria,
      nodeCount: pass.nodeCount,
    });
  }

  return { findings, passes, degradations, axeVersion: result.axeVersion };
}
