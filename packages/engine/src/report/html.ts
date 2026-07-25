import {
  coverageHeadline,
  isAiSource,
  type Evidence,
  type Finding,
  type ModelInvocation,
  type Report,
  type ScRollup,
  type ScStatus,
} from '@handrail/schemas';
import { CRITERIA, type KnownScId } from '@handrail/wcag';

/**
 * **Everything in this file treats its input as hostile.**
 *
 * A report is rendered from a page Handrail was pointed at, and that page's
 * author chose every accessible name, every attribute value and every DOM
 * excerpt in it. `report.html` is opened by the person who ran the scan, so an
 * unescaped attribute value is a stored XSS with a very cooperative delivery
 * mechanism. Two rules hold the line:
 *
 * 1. **Every interpolation goes through {@link escapeHtml}.** There is no
 *    "this one is a number so it's fine" exception — numbers get `String()` and
 *    then escaping like everything else, because the cost is nil and the
 *    exception is what rots.
 * 2. **No page-derived value ever reaches JavaScript.** The filter script reads
 *    `data-tier` / `data-source` attributes, which are values from our own
 *    closed enums, and nothing else. There is no embedded JSON island, so there
 *    is no `</script>` break-out to get wrong.
 *
 * Ampersand is replaced **first**; reversing that order double-escapes every
 * entity the later rules produce. Same class of ordering bug as the
 * backslash-then-quote one the selector escaper documents.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A URL safe to put in `href`.
 *
 * Scheme allowlist rather than a blocklist: `javascript:`, `data:` and `vbscript:`
 * are the ones everybody remembers, and the ones nobody remembers are the
 * problem. Anything that is not plain http(s) comes back `undefined` and the
 * caller renders text instead of a link.
 */
export function safeHref(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return escapeHtml(parsed.toString());
  } catch {
    return undefined;
  }
}

/** A rendered evidence image, ready to inline. See `evidence-images.ts`. */
export interface EvidenceImage {
  /** `data:image/png;base64,…` — self-contained, no external request. */
  dataUri: string;
  width: number;
  height: number;
  /** Where the element sits inside this image, as percentages of its box. */
  highlight?: { left: number; top: number; width: number; height: number };
}

export interface RenderReportOptions {
  /** Evidence images keyed by `"<findingId>:<evidenceIndex>"`. */
  images?: ReadonlyMap<string, EvidenceImage>;
  /** The cost footer's raw material. */
  invocations?: readonly ModelInvocation[];
  /** AI candidates the verdict pipeline threw away. Reported, not hidden. */
  candidatesRejected?: number;
}

const STATUS_LABEL: Record<ScStatus, string> = {
  fail: 'Fail',
  'needs-review': 'Needs review',
  pass: 'Pass (verified)',
  'not-applicable': 'Not applicable',
  'not-tested': 'Not tested',
};

const TIER_LABEL = {
  violation: 'Violation — measured',
  likely: 'Likely — AI + verifier',
  'needs-review': 'Needs review',
} as const;

function esc(value: string | number): string {
  return escapeHtml(typeof value === 'number' ? String(value) : value);
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  return `${String(Math.floor(seconds / 60))} min ${String(Math.round(seconds % 60))} s`;
}

/** `ai-text` and `ai-vision` are the two AI sources; everything else is measured. */
function sourceKind(finding: Finding): 'ai' | 'deterministic' {
  return finding.source.some(isAiSource) ? 'ai' : 'deterministic';
}

function criterionTitle(sc: string): string {
  return CRITERIA[sc as KnownScId]?.title ?? 'Unknown criterion';
}

function scLinks(finding: Finding): string {
  return finding.sc
    .map((id) => {
      const num = String(id);
      const primary = num === String(finding.scPrimary);
      return (
        `<li><span class="sc${primary ? ' sc-primary' : ''}">` +
        `<strong>${esc(num)}</strong> ${esc(criterionTitle(num))}` +
        `${primary ? '<span class="visually-hidden"> (primary criterion)</span>' : ''}</span></li>`
      );
    })
    .join('');
}

function renderEvidence(finding: Finding, index: number, options: RenderReportOptions): string {
  const evidence: Evidence | undefined = finding.evidence[index];
  if (evidence === undefined) return '';

  switch (evidence.kind) {
    case 'screenshot': {
      const image = options.images?.get(`${String(finding.id)}:${String(index)}`);
      if (image === undefined) {
        return `<p class="evidence-note">Screenshot evidence <code>${esc(String(evidence.artifactId))}</code> was captured but is not embedded in this file.</p>`;
      }
      const box =
        image.highlight === undefined
          ? ''
          : `<span class="bbox" style="left:${esc(image.highlight.left.toFixed(3))}%;top:${esc(
              image.highlight.top.toFixed(3),
            )}%;width:${esc(image.highlight.width.toFixed(3))}%;height:${esc(
              image.highlight.height.toFixed(3),
            )}%"></span>`;
      const caption = evidence.caption ?? 'The region of the page this finding is about.';
      return (
        `<figure class="shot">` +
        `<div class="shot-frame" style="aspect-ratio:${esc(image.width)} / ${esc(image.height)}">` +
        `<img src="${esc(image.dataUri)}" alt="Screenshot of the page region described in this finding." width="${esc(image.width)}" height="${esc(image.height)}">` +
        `${box}</div>` +
        `<figcaption>${esc(caption)}${image.highlight === undefined ? '' : ' The outlined box marks the element.'}</figcaption>` +
        `</figure>`
      );
    }
    case 'dom':
      return (
        `<div class="evidence-block"><h5>Captured markup</h5>` +
        `<pre><code>${esc(evidence.excerpt)}</code></pre></div>`
      );
    case 'pixels': {
      const comparator = evidence.comparator === 'gte' ? 'at least' : 'at most';
      return (
        `<div class="evidence-block"><h5>Measured</h5>` +
        `<p class="measurement"><strong>${esc(evidence.metric)}</strong>: measured ` +
        `<span class="measured">${esc(evidence.measured)}</span>, requires ${esc(comparator)} ` +
        `<span class="threshold">${esc(evidence.threshold)}</span>.</p></div>`
      );
    }
    case 'tool':
      return (
        `<div class="evidence-block"><h5>Tool output — ${esc(evidence.tool)}` +
        `${evidence.ruleId === undefined ? '' : ` (${esc(evidence.ruleId)})`}</h5>` +
        `<pre><code>${esc(evidence.output)}</code></pre></div>`
      );
    default:
      return '';
  }
}

function renderFinding(finding: Finding, options: RenderReportOptions): string {
  const kind = sourceKind(finding);
  const headingId = `f-${esc(String(finding.id))}-h`;
  const element = finding.element;
  const pageHref = safeHref(finding.page.url);

  return (
    `<li class="finding" data-tier="${esc(finding.tier)}" data-source="${esc(kind)}">` +
    `<article aria-labelledby="${headingId}">` +
    `<h3 id="${headingId}">${esc(criterionTitle(String(finding.scPrimary)))} ` +
    `<span class="sc-num">${esc(String(finding.scPrimary))}</span></h3>` +
    `<p class="badges">` +
    `<span class="badge badge-${esc(finding.tier)}">${esc(TIER_LABEL[finding.tier])}</span>` +
    `<span class="badge badge-source-${esc(kind)}">${kind === 'ai' ? 'AI judgment' : 'Deterministic'}</span>` +
    `<span class="badge badge-sev">${esc(finding.severity)}</span>` +
    `<span class="badge badge-check">${esc(finding.checkId)}</span>` +
    `</p>` +
    `<p class="description">${esc(finding.description)}</p>` +
    `<h4>Success criteria</h4><ul class="sc-list">${scLinks(finding)}</ul>` +
    (element === undefined
      ? ''
      : `<h4>Element</h4><p class="element"><code>${esc(element.selector)}</code>` +
        (element.role === undefined ? '' : ` &middot; role <code>${esc(element.role)}</code>`) +
        (element.accessibleName === undefined
          ? ''
          : ` &middot; accessible name &ldquo;${esc(element.accessibleName)}&rdquo;`) +
        `</p>`) +
    `<h4>Evidence</h4>` +
    (finding.evidence.length === 0
      ? `<p class="evidence-note">No evidence — which is why this finding cannot rise above needs-review.</p>`
      : finding.evidence.map((_, index) => renderEvidence(finding, index, options)).join('')) +
    (finding.remediation === undefined
      ? ''
      : `<h4>Suggested fix${finding.remediation.suggested ? ' (model-written — read before shipping)' : ''}</h4>` +
        `<p>${esc(finding.remediation.summary)}</p>`) +
    `<p class="page-ref">Found on ${
      pageHref === undefined ? `<code>${esc(finding.page.url)}</code>` : `<a href="${pageHref}">${esc(finding.page.url)}</a>`
    } at the <strong>${esc(finding.page.viewport)}</strong> viewport. ` +
    `Verification: ${esc(finding.verification.method)} &rarr; ${esc(finding.verification.status)}.</p>` +
    `</article></li>`
  );
}

function renderCriteriaRow(rollup: ScRollup): string {
  const num = String(rollup.sc);
  return (
    `<tr data-status="${esc(rollup.status)}">` +
    `<th scope="row"><span class="sc-num">${esc(num)}</span> ${esc(criterionTitle(num))}</th>` +
    `<td>${esc(rollup.level)}</td>` +
    `<td><span class="status status-${esc(rollup.status)}">${esc(STATUS_LABEL[rollup.status])}</span></td>` +
    `<td>${rollup.checksRun.length === 0 ? '<span class="muted">none</span>' : rollup.checksRun.map((c) => `<code>${esc(c)}</code>`).join(' ')}</td>` +
    `<td class="rationale">${esc(rollup.rationale)}</td>` +
    `</tr>`
  );
}

function renderCostFooter(report: Report, options: RenderReportOptions): string {
  const invocations = options.invocations ?? [];
  const byRole = new Map<string, { calls: number; costUsd: number; input: number; output: number }>();
  for (const invocation of invocations) {
    const bucket = byRole.get(invocation.role) ?? { calls: 0, costUsd: 0, input: 0, output: 0 };
    bucket.calls += 1;
    bucket.costUsd += invocation.costUsd;
    bucket.input += invocation.usage.input;
    bucket.output += invocation.usage.output;
    byRole.set(invocation.role, bucket);
  }

  const rows = [...byRole]
    .map(
      ([role, bucket]) =>
        `<tr><th scope="row">${esc(role)}</th><td>${esc(bucket.calls)}</td>` +
        `<td>${esc(bucket.input)}</td><td>${esc(bucket.output)}</td>` +
        `<td>${esc(money(bucket.costUsd))}</td></tr>`,
    )
    .join('');

  return (
    `<h2 id="cost-h">Cost</h2>` +
    `<p>This scan ran in <strong>${esc(report.scan.options.mode)}</strong> mode and cost ` +
    `<strong>${esc(money(report.scan.costUsd))}</strong> in model calls` +
    `${invocations.length === 0 ? ' — no model was called at all.' : `, across ${esc(invocations.length)} invocation(s).`}</p>` +
    (rows === ''
      ? ''
      : `<div class="scroll" role="region" aria-label="Model cost by role" tabindex="0">` +
        `<table><caption>Model spend by role</caption><thead><tr>` +
        `<th scope="col">Role</th><th scope="col">Calls</th><th scope="col">Input tokens</th>` +
        `<th scope="col">Output tokens</th><th scope="col">Cost</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`) +
    (options.candidatesRejected === undefined || options.candidatesRejected === 0
      ? ''
      : `<p>${esc(options.candidatesRejected)} AI candidate(s) were rejected before reporting — by grounding, ` +
        `deduplication, a deterministic re-check or the independent verifier. They are recorded in ` +
        `<code>hallucination-ledger.json</code> beside this file and are deliberately not shown as findings.</p>`)
  );
}

function renderDegradations(report: Report): string {
  if (report.scan.degradations.length === 0) return '';
  return (
    `<div class="callout callout-warn" role="note" aria-labelledby="degraded-h">` +
    `<h3 id="degraded-h">This scan was degraded</h3>` +
    `<p>Handrail could not do everything it set out to. Nothing below was silently substituted; ` +
    `these are the things that did not happen.</p><ul>` +
    report.scan.degradations
      .map(
        (degradation) =>
          `<li><strong>${esc(degradation.reason)}</strong>${
            degradation.phase === undefined ? '' : ` in <code>${esc(degradation.phase)}</code>`
          } — ${esc(degradation.detail)}</li>`,
      )
      .join('') +
    `</ul></div>`
  );
}

/**
 * Render the self-contained `report.html`.
 *
 * Self-contained literally: one file, no external stylesheet, no font request,
 * no script tag pointing anywhere. Screenshots are inlined as data URIs. A
 * report that phones home would leak the URL of every scanned page to whoever
 * hosts the assets, and would stop working the moment it was emailed to someone.
 *
 * It also has to be accessible, and not as a nicety — the glass-house rule means
 * Handrail scans this file with its own engine in CI. Landmarks are real, the
 * heading outline is unbroken, the filters are native form controls inside a
 * labelled fieldset, focus is always visible, and nothing is signalled by colour
 * alone: every tier and status badge carries its own words.
 */
export function renderReportHtml(report: Report, options: RenderReportOptions = {}): string {
  const target = report.scan.target;
  const targetUrl = target.kind === 'url' ? target.url : target.baseUrl;
  const targetHref = safeHref(targetUrl);
  const headline = coverageHeadline(report.coverage);
  const findings = [...report.findings].sort(
    (a, b) => tierRank(b.tier) - tierRank(a.tier) || String(a.scPrimary).localeCompare(String(b.scPrimary)),
  );
  const manual = report.scRollups.filter(
    (rollup) => rollup.status === 'not-tested' || rollup.status === 'needs-review',
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accessibility report — ${esc(targetUrl)}</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to the report</a>
<header class="page-header">
  <p class="eyebrow">Handrail ${esc(report.tool.version)} &middot; WCAG ${esc(report.scan.options.wcagTarget.version)} Level ${esc(report.scan.options.wcagTarget.level)}</p>
  <h1>Accessibility report</h1>
  <p class="target">${targetHref === undefined ? esc(targetUrl) : `<a href="${targetHref}">${esc(targetUrl)}</a>`}</p>
  <p class="headline">${esc(headline)}</p>
  <p class="generated">Generated ${esc(report.generatedAt)} &middot; scan <code>${esc(String(report.scan.id))}</code> &middot; ${esc(duration(scanDurationMs(report)))}</p>
</header>
<nav aria-label="Report sections">
  <ul>
    <li><a href="#summary">Summary</a></li>
    <li><a href="#findings">Findings (${esc(findings.length)})</a></li>
    <li><a href="#criteria">All ${esc(report.coverage.criteriaTotal)} criteria</a></li>
    <li><a href="#manual">Human testing (${esc(manual.length)})</a></li>
    <li><a href="#about">Cost &amp; method</a></li>
  </ul>
</nav>
<main id="main">
  <section id="summary" aria-labelledby="summary-h">
    <h2 id="summary-h">Summary</h2>
    ${renderDegradations(report)}
    <div class="scroll" role="region" aria-label="Coverage ledger" tabindex="0">
      <table class="ledger">
        <caption>Every criterion in scope lands in exactly one row, and the rows add up to ${esc(report.coverage.criteriaTotal)}.</caption>
        <thead><tr><th scope="col">Outcome</th><th scope="col">Criteria</th><th scope="col">What it means</th></tr></thead>
        <tbody>
          <tr><th scope="row">Fail</th><td>${esc(report.coverage.failed)}</td><td>At least one measured violation or verified-likely finding.</td></tr>
          <tr><th scope="row">Needs review</th><td>${esc(report.coverage.needsReview)}</td><td>Something was flagged that a person has to adjudicate.</td></tr>
          <tr><th scope="row">Pass (verified)</th><td>${esc(report.coverage.passVerified)}</td><td>A check that can <em>decide</em> this criterion examined real candidates and found no failure.</td></tr>
          <tr><th scope="row">Not applicable</th><td>${esc(report.coverage.notApplicable)}</td><td>Nothing captured falls under the criterion.</td></tr>
          <tr><th scope="row">Not tested</th><td>${esc(report.coverage.notTested)}</td><td>No automated check could settle it. Listed in full below — never hidden.</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">The trend indicator for this scan is <strong>${esc(report.trendScore.value)}</strong>. ${esc(report.trendScore.disclaimer)}</p>
  </section>

  <section id="findings" aria-labelledby="findings-h">
    <h2 id="findings-h">Findings</h2>
    <form class="filters" aria-labelledby="filters-h">
      <h3 id="filters-h">Filter</h3>
      <fieldset>
        <legend>Confidence tier</legend>
        <label><input type="checkbox" class="filter-tier" value="violation" checked> Violation — measured</label>
        <label><input type="checkbox" class="filter-tier" value="likely" checked> Likely — AI + verifier</label>
        <label><input type="checkbox" class="filter-tier" value="needs-review" checked> Needs review</label>
      </fieldset>
      <fieldset>
        <legend>Source</legend>
        <label><input type="checkbox" class="filter-source" value="deterministic" checked> Deterministic</label>
        <label><input type="checkbox" class="filter-source" value="ai" checked> AI judgment</label>
      </fieldset>
    </form>
    <p id="finding-count" role="status">Showing ${esc(findings.length)} of ${esc(findings.length)} findings.</p>
    ${
      findings.length === 0
        ? `<p class="note">No findings. That is not the same as "no problems": read the coverage ledger above and the human-testing checklist below before drawing any conclusion.</p>`
        : `<ol class="findings">${findings.map((finding) => renderFinding(finding, options)).join('')}</ol>`
    }
  </section>

  <section id="criteria" aria-labelledby="criteria-h">
    <h2 id="criteria-h">All ${esc(report.coverage.criteriaTotal)} criteria</h2>
    <p>Including the ones nothing automated could check. That is the point of the table.</p>
    <div class="scroll" role="region" aria-label="Per-criterion outcomes" tabindex="0">
      <table class="criteria">
        <caption>Outcome per WCAG success criterion, with the checks that contributed.</caption>
        <thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Outcome</th><th scope="col">Checks run</th><th scope="col">Why</th></tr></thead>
        <tbody>${report.scRollups.map(renderCriteriaRow).join('')}</tbody>
      </table>
    </div>
  </section>

  <section id="manual" aria-labelledby="manual-h">
    <h2 id="manual-h">What a human still has to test</h2>
    <p>${esc(manual.length)} criteria could not be settled automatically. Automation honestly ends here; a screen-reader pass and a keyboard pass start.</p>
    <ol class="manual">
      ${manual
        .map(
          (rollup) =>
            `<li><h3><span class="sc-num">${esc(String(rollup.sc))}</span> ${esc(criterionTitle(String(rollup.sc)))}</h3>` +
            `<p>${esc(CRITERIA[String(rollup.sc) as KnownScId]?.manualProcedure ?? rollup.rationale)}</p></li>`,
        )
        .join('')}
    </ol>
  </section>

  <section id="about" aria-labelledby="cost-h">
    ${renderCostFooter(report, options)}
    <h3>How to read this report</h3>
    <ul>
      <li><strong>Violation</strong> means Handrail measured it — a rule engine or a pixel measurement, reproducible without a model.</li>
      <li><strong>Likely</strong> means a language model claimed it and a separate, independently-prompted verifier agreed. It is never higher than that.</li>
      <li><strong>Needs review</strong> means the evidence did not settle it. It is surfaced rather than dropped.</li>
      <li>There is no score out of 100 here on purpose. No automated tool can measure whether a site is usable, and a single number invites exactly that misreading.</li>
    </ul>
  </section>
</main>
<footer class="page-footer">
  <p>Generated by <strong>Handrail</strong> ${esc(report.tool.version)} — the open-source AI accessibility engineer. Report format version ${esc(report.reportVersion)}.</p>
</footer>
<script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}

function tierRank(tier: Finding['tier']): number {
  return tier === 'violation' ? 2 : tier === 'likely' ? 1 : 0;
}

function scanDurationMs(report: Report): number {
  const started = report.scan.startedAt;
  const finished = report.scan.finishedAt;
  if (started === undefined || finished === undefined) return 0;
  return Math.max(0, Date.parse(finished) - Date.parse(started));
}

/**
 * The filter behaviour. It reads only `data-tier` and `data-source`, both of
 * which come from our own closed enums — no page-derived string is ever handed
 * to script. Written to degrade gracefully: with JavaScript off, every finding
 * is visible and only the filter controls stop working.
 */
const FILTER_SCRIPT = `
(function () {
  var list = document.querySelectorAll('.findings > .finding');
  var count = document.getElementById('finding-count');
  var tiers = document.querySelectorAll('.filter-tier');
  var sources = document.querySelectorAll('.filter-source');
  function selected(nodes) {
    var out = [];
    nodes.forEach(function (node) { if (node.checked) out.push(node.value); });
    return out;
  }
  function apply() {
    var tier = selected(tiers);
    var source = selected(sources);
    var shown = 0;
    list.forEach(function (item) {
      var visible =
        tier.indexOf(item.getAttribute('data-tier')) !== -1 &&
        source.indexOf(item.getAttribute('data-source')) !== -1;
      item.hidden = !visible;
      if (visible) shown += 1;
    });
    if (count) {
      count.textContent = 'Showing ' + shown + ' of ' + list.length + ' findings.';
    }
  }
  tiers.forEach(function (node) { node.addEventListener('change', apply); });
  sources.forEach(function (node) { node.addEventListener('change', apply); });
})();
`;

/**
 * Tokens first, then components.
 *
 * Colour pairs are contrast-checked against 4.5:1 in both schemes, focus rings
 * are 3px and offset so they never sit on top of the control they mark, and
 * every interactive target clears 24×24. This file is scanned by the same engine
 * that produced it, so a shortcut here shows up as a finding in our own CI.
 */
const STYLES = `
:root {
  --bg: #ffffff;
  --surface: #f5f6f8;
  --border: #c9cdd4;
  --text: #16181d;
  --muted: #4c525c;
  --accent: #0b4fd6;
  --fail: #8c1c13;
  --fail-bg: #fdecea;
  --warn: #6b4708;
  --warn-bg: #fdf3d8;
  --pass: #14532d;
  --pass-bg: #e6f4ea;
  --focus: #0b4fd6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --surface: #1e2127;
    --border: #444a55;
    --text: #e9ecf1;
    --muted: #b3bac5;
    --accent: #8ab4ff;
    --fail: #ffb4aa;
    --fail-bg: #3a1512;
    --warn: #f5cf7a;
    --warn-bg: #3a2c0c;
    --pass: #9fe0b5;
    --pass-bg: #12301d;
    --focus: #8ab4ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
a { color: var(--accent); }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
.skip-link {
  position: absolute; left: -9999px; top: 0; padding: .75rem 1rem;
  background: var(--surface); color: var(--text); z-index: 10;
}
.skip-link:focus { left: 0; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
.page-header, nav, main, .page-footer { max-width: 60rem; margin: 0 auto; padding: 0 1.25rem; }
.page-header { padding-top: 2.5rem; }
.eyebrow { color: var(--muted); margin: 0 0 .25rem; font-size: .875rem; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-size: 2rem; margin: 0 0 .25rem; line-height: 1.25; }
h2 { font-size: 1.5rem; margin: 2.5rem 0 .75rem; }
h3 { font-size: 1.15rem; margin: 1.5rem 0 .5rem; }
h4 { font-size: .95rem; margin: 1.25rem 0 .35rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
h5 { font-size: .85rem; margin: .75rem 0 .25rem; color: var(--muted); }
.target { font-size: 1.05rem; margin: 0 0 1rem; word-break: break-all; }
.headline { font-size: 1.15rem; font-weight: 600; margin: 0 0 .5rem; }
.generated, .note, .muted { color: var(--muted); }
.generated { font-size: .9rem; }
nav ul { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; list-style: none; margin: 1rem auto; padding: .75rem 1.25rem;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
nav a { display: inline-block; padding: .35rem .25rem; min-height: 24px; }
section { margin-bottom: 3rem; }
.callout { border-left: 6px solid var(--warn); background: var(--warn-bg); color: var(--text); padding: 1rem 1.25rem; border-radius: 4px; }
.callout h3 { margin-top: 0; color: var(--warn); }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: .95rem; }
caption { text-align: left; padding: .75rem 1rem; color: var(--muted); font-size: .9rem; }
th, td { text-align: left; padding: .6rem 1rem; border-top: 1px solid var(--border); vertical-align: top; }
thead th { background: var(--surface); border-top: 0; white-space: nowrap; }
tbody th { font-weight: 600; }
td.rationale { min-width: 22rem; color: var(--muted); }
.filters { border: 1px solid var(--border); border-radius: 6px; padding: 1rem 1.25rem; margin: 1rem 0; background: var(--surface); }
.filters h3 { margin: 0 0 .5rem; font-size: 1rem; }
.filters fieldset { border: 0; margin: 0 0 .5rem; padding: 0; display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; align-items: center; }
.filters legend { padding: 0; font-weight: 600; font-size: .9rem; }
.filters label { display: inline-flex; align-items: center; gap: .4rem; min-height: 24px; padding: .25rem 0; }
.filters input { width: 20px; height: 20px; margin: 2px; }
ol.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem; }
.finding article { border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; background: var(--surface); }
.finding h3 { margin-top: 0; }
.sc-num { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); font-size: .9em; }
.badges { display: flex; flex-wrap: wrap; gap: .4rem; margin: .5rem 0 1rem; }
.badge { display: inline-block; padding: .2rem .6rem; border-radius: 999px; font-size: .8rem; font-weight: 600;
  border: 1px solid var(--border); background: var(--bg); }
.badge-violation { color: var(--fail); background: var(--fail-bg); border-color: var(--fail); }
.badge-likely { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
.badge-needs-review { color: var(--muted); }
.badge-source-ai { border-style: dashed; }
.sc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; }
.sc-primary { font-weight: 600; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em;
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: .05rem .3rem; word-break: break-all; }
pre { overflow-x: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: .75rem 1rem; margin: .25rem 0; }
pre code { border: 0; background: none; padding: 0; white-space: pre; }
.shot { margin: .5rem 0 1rem; }
.shot-frame { position: relative; display: block; max-width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.shot img { display: block; width: 100%; height: auto; }
.bbox { position: absolute; border: 3px solid #d92d20; box-shadow: 0 0 0 3px rgba(255,255,255,.9); border-radius: 2px; }
figcaption { color: var(--muted); font-size: .9rem; margin-top: .35rem; }
.status { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-weight: 600; white-space: nowrap;
  border: 1px solid var(--border); }
.status-fail { color: var(--fail); background: var(--fail-bg); border-color: var(--fail); }
.status-needs-review { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
.status-pass { color: var(--pass); background: var(--pass-bg); border-color: var(--pass); }
ol.manual { display: grid; gap: 1rem; padding-left: 1.25rem; }
ol.manual h3 { margin: 0 0 .25rem; font-size: 1rem; }
.page-footer { border-top: 1px solid var(--border); padding-top: 1.25rem; padding-bottom: 3rem; color: var(--muted); font-size: .9rem; }
@media (max-width: 32rem) {
  .page-header, nav, main, .page-footer { padding: 0 1rem; }
  td.rationale { min-width: 14rem; }
}
`;
