import type { Finding, Report, Tier } from '@handrail/schemas';
import { findCriterion } from '@handrail/wcag';

/**
 * SARIF 2.1.0, rendered from the canonical `report.json`.
 *
 * This is the format GitHub code scanning ingests, so it is how a Handrail
 * finding becomes an annotation on a pull request. It is a *projection* of the
 * report and never a second source of truth: everything here is derived, and a
 * number that disagrees with `report.json` is a bug in this file.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const INFORMATION_URI = 'https://github.com/vrajjshah/handrail';

/** SARIF's severity vocabulary, and the honest mapping onto our tiers. */
export type SarifLevel = 'error' | 'warning' | 'note' | 'none';

/**
 * `likely` is a warning and never an error.
 *
 * The tier ceilings mean a `likely` finding rests on model judgment that a
 * verifier agreed with — good enough to raise, not good enough to fail someone's
 * build without them opting in. Collapsing it into `error` here would quietly
 * undo the distinction the entire verdict pipeline exists to maintain.
 */
export const SARIF_LEVEL_FOR_TIER: Record<Tier, SarifLevel> = {
  violation: 'error',
  likely: 'warning',
  'needs-review': 'note',
};

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  help: { text: string };
  defaultConfiguration: { level: SarifLevel };
  properties: {
    tags: string[];
    /** GitHub renders this in the alert list. */
    'security-severity'?: string;
  };
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number; startColumn: number };
    };
    logicalLocations?: { name: string; kind: string }[];
  }[];
  partialFingerprints: Record<string, string>;
  properties: Record<string, unknown>;
}

/** A tool-level message: something about the run, not about the site. */
export interface SarifNotification {
  message: { text: string };
  level: SarifLevel;
}

/**
 * A `type`, not an `interface`, on purpose: only a type alias gets an implicit
 * index signature, and without one this cannot be handed to a server route
 * whose response schema is a loose object. The alternative was a cast at the
 * call site, which would have silenced real shape errors too.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see above
export type SarifLog = {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    automationDetails: { id: string };
    invocations: {
      executionSuccessful: boolean;
      endTimeUtc: string;
      toolExecutionNotifications: SarifNotification[];
    }[];
    results: SarifResult[];
  }[];
};

/** `2.4.4` → `WCAG2AA`-style tags a triage tool can filter on. */
function tagsFor(finding: Finding): string[] {
  const tags = ['accessibility', `handrail-tier:${finding.tier}`];
  for (const sc of finding.sc) {
    tags.push(`wcag:${sc}`);
    const criterion = findCriterion(sc);
    if (criterion !== undefined) tags.push(`wcag2${criterion.level.toLowerCase()}`);
  }
  for (const source of finding.source) tags.push(`source:${source}`);
  return [...new Set(tags)];
}

/**
 * A stable identity for one finding, so re-running the scan updates an alert
 * rather than opening a second one.
 *
 * The finding id already hashes the check, the page state and the element, so
 * it is exactly the fingerprint SARIF is asking for — but it is emitted under
 * SARIF's versioned key so a future change of scheme does not silently look
 * like the same fingerprint.
 */
function fingerprints(finding: Finding): Record<string, string> {
  return {
    elemFingerprint: finding.id,
    'handrail/elemFingerprint/v1': `${finding.checkId}:${finding.element?.xpath ?? finding.element?.selector ?? finding.page.pageStateId}`,
  };
}

function ruleFor(finding: Finding): SarifRule {
  const criterion = findCriterion(finding.scPrimary);
  const title = criterion === undefined ? finding.scPrimary : `${criterion.num} ${criterion.title}`;
  return {
    id: finding.checkId,
    name: finding.checkId,
    shortDescription: { text: title },
    fullDescription: {
      text: criterion?.understanding ?? `Handrail check ${finding.checkId}.`,
    },
    help: {
      text:
        criterion === undefined
          ? `Handrail check ${finding.checkId}.`
          : `${criterion.userImpact}\n\nHow Handrail decides this: ${criterion.testability}.`,
    },
    defaultConfiguration: { level: SARIF_LEVEL_FOR_TIER[finding.tier] },
    properties: { tags: tagsFor(finding) },
  };
}

/**
 * The message a reviewer reads in the GitHub UI.
 *
 * It leads with the tier and the source, because "a model thinks so and a
 * second model agreed" and "we measured 16 pixels where 24 are required" are
 * different claims and a PR annotation that hides which one it is has given up
 * the thing that makes Handrail worth using.
 */
function messageFor(finding: Finding): string {
  const provenance = finding.source.join(', ');
  return `[${finding.tier}] ${finding.description} (${finding.scPrimary}, via ${provenance})`;
}

export interface SarifOptions {
  /** Correlates re-runs of the same logical scan in GitHub's UI. */
  automationId?: string;
}

export function renderSarif(report: Report, options: SarifOptions = {}): SarifLog {
  const rules: SarifRule[] = [];
  const ruleIndex = new Map<string, number>();

  const results: SarifResult[] = report.findings.map((finding) => {
    let index = ruleIndex.get(finding.checkId);
    if (index === undefined) {
      index = rules.length;
      ruleIndex.set(finding.checkId, index);
      rules.push(ruleFor(finding));
    }

    return {
      ruleId: finding.checkId,
      ruleIndex: index,
      level: SARIF_LEVEL_FOR_TIER[finding.tier],
      message: { text: messageFor(finding) },
      locations: [
        {
          physicalLocation: {
            // A URL scan has no file to point at, so the page *is* the artifact.
            // Repo-mode source mapping is the fix engine's job (Phase 4), and
            // inventing a file path here would be worse than not having one.
            artifactLocation: { uri: finding.page.url },
          },
          ...(finding.element === undefined
            ? {}
            : {
                logicalLocations: [
                  { name: finding.element.selector, kind: 'element' },
                ],
              }),
        },
      ],
      partialFingerprints: fingerprints(finding),
      properties: {
        tier: finding.tier,
        severity: finding.severity,
        confidence: finding.confidence,
        sc: finding.sc,
        source: finding.source,
        viewport: finding.page.viewport,
        verification: finding.verification,
        evidenceKinds: [...new Set(finding.evidence.map((item) => item.kind))],
        ...(finding.dedupeCount > 1 ? { dedupeCount: finding.dedupeCount } : {}),
      },
    };
  });

  // Degradations become tool notifications rather than results. A scan that
  // could not reach its model is not a finding about the site, and burying that
  // distinction is how a partial scan gets read as a clean one.
  const notifications: SarifNotification[] = report.scan.degradations.map((degradation) => ({
    message: { text: `${degradation.reason}: ${degradation.detail}` },
    level: 'warning',
  }));

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Handrail',
            version: report.tool.version,
            informationUri: INFORMATION_URI,
            rules,
          },
        },
        automationDetails: { id: options.automationId ?? `handrail/${report.scan.id}` },
        invocations: [
          {
            executionSuccessful: report.scan.status !== 'failed',
            endTimeUtc: report.generatedAt,
            toolExecutionNotifications: notifications,
          },
        ],
        results,
      },
    ],
  };
}
