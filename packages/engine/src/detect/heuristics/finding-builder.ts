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
  type Tier,
} from '@handrail/schemas';
import type { KnownScId } from '@handrail/wcag';

import type { ElementRecord, StateCapture } from '../../capture/types.js';

/**
 * A stable id for a heuristic finding.
 *
 * Deterministic — from state, check and element — so a re-scan of the same page
 * produces the same ids. That is what the golden-scan snapshot and the judgment
 * cache both rely on.
 */
function deterministicFindingId(pageStateId: string, checkId: string, anchor: string): string {
  const digest = createHash('sha256').update(`${pageStateId}|${checkId}|${anchor}`).digest('hex');
  return `find_${digest.slice(0, 16)}`;
}

/** DOM evidence built from an indexed element, capped to the schema's limit. */
export function domEvidenceFor(element: ElementRecord): Evidence {
  const excerpt = element.text !== null ? `<${element.tag}>${element.text}</${element.tag}>` : element.selector;
  return { kind: 'dom', excerpt: excerpt.slice(0, 4000), selector: element.selector };
}

export interface HeuristicFindingSpec {
  checkId: CheckId;
  element: ElementRecord;
  sc: readonly KnownScId[];
  tier: Tier;
  severity: Severity;
  description: string;
  evidence: Evidence[];
}

/**
 * Builds a grounded heuristic finding.
 *
 * The `heuristic:<checkId>` source and the deterministic evidence a caller
 * supplies are what let a violation reach `violation` tier under the schema's
 * matrix — the same rule the axe layer relies on. The element is always grounded
 * (it came from the index), so there is a real bbox for the report to crop to.
 */
export function buildHeuristicFinding(spec: HeuristicFindingSpec, capture: StateCapture): Finding {
  const { element } = spec;
  const input: FindingInput = {
    id: findingId(deterministicFindingId(capture.pageStateId, spec.checkId, element.xpath)),
    checkId: spec.checkId,
    source: `heuristic:${spec.checkId}`,
    sc: spec.sc as unknown as ScId[],
    scPrimary: spec.sc[0] as unknown as ScId,
    tier: spec.tier,
    severity: spec.severity,
    confidence: 1,
    evidence: spec.evidence,
    element: {
      elementId: element.elemId,
      selector: element.selector,
      xpath: element.xpath,
      ...(element.bbox !== null ? { bbox: element.bbox } : {}),
      ...(element.accessibleName !== null ? { accessibleName: element.accessibleName } : {}),
      ...(element.role !== null ? { role: element.role } : {}),
    },
    page: {
      url: capture.url,
      pageStateId: capture.pageStateId,
      viewport: capture.viewport.label,
    },
    // The heuristic measured it deterministically; the verdict pipeline (a later
    // stage) may still re-check, but the measurement itself is certain.
    verification: { method: 'none', status: 'unverified' },
    description: spec.description,
  };
  return FindingSchema.parse(input);
}
