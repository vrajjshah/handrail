import { FindingSchema, type Evidence, type Finding } from '@handrail/schemas';

import type { StateCapture } from '../capture/types.js';

/**
 * Give every grounded finding a picture of the thing it is about.
 *
 * Detection layers produce the evidence they can *measure* — a tool message, a
 * DOM excerpt, a contrast ratio. None of them produce a screenshot, because none
 * of them should: a check that had to reason about pixels to report a missing
 * `alt` attribute would be a worse check. Attaching the visual afterwards, from
 * the capture the finding already names, keeps that separation and still gives
 * the reader something to look at.
 *
 * **This can never raise a tier.** Screenshot evidence is not deterministic
 * evidence (`isDeterministicEvidence` is false for it), so the tier matrix reads
 * it as nothing; and `FindingSchema`'s transform only ever downgrades. A finding
 * that was `needs-review` because it had no evidence stays `needs-review` — it
 * just now shows the element a human is being asked to look at.
 */
export function attachScreenshotEvidence(
  findings: readonly Finding[],
  captures: readonly StateCapture[],
): Finding[] {
  const byPageState = new Map(captures.map((capture) => [String(capture.pageStateId), capture]));

  return findings.map((finding) => {
    const bbox = finding.element?.bbox;
    if (bbox === undefined) return finding;
    if (finding.evidence.some((evidence) => evidence.kind === 'screenshot')) return finding;

    const capture = byPageState.get(String(finding.page.pageStateId));
    const artifactId = capture?.artifacts.fullPage;
    if (artifactId === null || artifactId === undefined) return finding;

    const screenshot: Evidence = {
      kind: 'screenshot',
      artifactId,
      bbox,
      caption: `${finding.checkId} on the ${finding.page.viewport} capture of this page.`,
    };

    return FindingSchema.parse({ ...finding, evidence: [screenshot, ...finding.evidence] });
  });
}
