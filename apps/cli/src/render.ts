import type { Finding, ScanEvent, ScanPhase } from '@handrail/schemas';

/**
 * ANSI, but only when someone is watching.
 *
 * Colour is switched off for a pipe, for `NO_COLOR`, and for dumb terminals —
 * and it is never the only carrier of meaning. Every tier is spelled out in
 * words next to its colour, which is the same rule the HTML report follows and
 * the same rule Handrail checks other people's sites for.
 */
export const ANSI = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  bold: '\u001B[1m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  green: '\u001B[32m',
  blue: '\u001B[34m',
  magenta: '\u001B[35m',
} as const;

export function colorEnabled(env: Record<string, string | undefined>, isTty: boolean): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return isTty;
}

const PHASE_LABEL: Record<ScanPhase, string> = {
  queued: 'queued',
  crawl: 'crawl',
  capture: 'capture',
  detect: 'detect',
  'judge-text': 'judge (text)',
  'judge-vision': 'judge (vision)',
  verdict: 'verdict',
  site: 'site checks',
  score: 'score',
  report: 'report',
  fix: 'fix',
};

const TIER_LABEL = {
  violation: 'violation   ',
  likely: 'likely      ',
  'needs-review': 'needs-review',
} as const;

export interface ProgressTotals {
  findings: number;
  violation: number;
  likely: number;
  needsReview: number;
  screenshots: number;
  modelCalls: number;
  costUsd: number;
  degradations: number;
}

export interface ProgressOptions {
  write: (line: string) => void;
  color?: boolean;
  /** Only phase transitions and the summary; individual findings are suppressed. */
  quiet?: boolean;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function describe(finding: Finding): string {
  const where = finding.element?.selector ?? finding.page.url;
  return `${String(finding.scPrimary).padEnd(6)} ${finding.checkId.padEnd(24)} ${where}`;
}

/**
 * Renders the scan's event stream as it arrives.
 *
 * The stream *is* the product: the orchestrator already decided what a phase is,
 * when a finding was found and what a degradation means, and the same events go
 * to the SSE endpoint and the golden-scan diff. So this class renders them and
 * derives nothing — no second progress model that could disagree with the first,
 * no counting findings a different way than the record does.
 */
export class ProgressRenderer {
  readonly totals: ProgressTotals = {
    findings: 0,
    violation: 0,
    likely: 0,
    needsReview: 0,
    screenshots: 0,
    modelCalls: 0,
    costUsd: 0,
    degradations: 0,
  };

  private readonly write: (line: string) => void;
  private readonly color: boolean;
  private readonly quiet: boolean;

  constructor(options: ProgressOptions) {
    this.write = options.write;
    this.color = options.color ?? false;
    this.quiet = options.quiet ?? false;
  }

  private paint(text: string, code: string): string {
    return this.color ? `${code}${text}${ANSI.reset}` : text;
  }

  /** Consume one event. Returns the lines it produced, which is what the tests read. */
  event(event: ScanEvent): void {
    switch (event.type) {
      case 'phase.started':
        this.write(this.paint(`> ${PHASE_LABEL[event.phase]}`, ANSI.bold));
        break;
      case 'phase.completed':
        if (!this.quiet) {
          this.write(this.paint(`  finished in ${seconds(event.durationMs)}`, ANSI.dim));
        }
        break;
      case 'phase.failed':
        this.write(this.paint(`  FAILED ${event.code}: ${event.message}`, ANSI.red));
        break;
      case 'finding.detected': {
        this.totals.findings += 1;
        if (event.finding.tier === 'violation') this.totals.violation += 1;
        else if (event.finding.tier === 'likely') this.totals.likely += 1;
        else this.totals.needsReview += 1;

        if (!this.quiet) {
          const code =
            event.finding.tier === 'violation'
              ? ANSI.red
              : event.finding.tier === 'likely'
                ? ANSI.yellow
                : ANSI.dim;
          this.write(
            `  ${this.paint(TIER_LABEL[event.finding.tier], code)}  ${describe(event.finding)}`,
          );
        }
        break;
      }
      case 'screenshot.captured':
        this.totals.screenshots += 1;
        if (!this.quiet) {
          this.write(this.paint(`  captured ${event.viewport} screenshot`, ANSI.dim));
        }
        break;
      case 'model.invoked':
        this.totals.modelCalls += 1;
        this.totals.costUsd += event.invocation.costUsd;
        if (!this.quiet) {
          this.write(
            this.paint(
              `  model ${event.invocation.role} ${String(event.invocation.usage.input)} in / ` +
                `${String(event.invocation.usage.output)} out  $${event.invocation.costUsd.toFixed(4)}`,
              ANSI.magenta,
            ),
          );
        }
        break;
      case 'scan.degraded':
        this.totals.degradations += 1;
        this.write(
          this.paint(
            `  DEGRADED ${event.degradation.reason}: ${event.degradation.detail}`,
            ANSI.yellow,
          ),
        );
        break;
      case 'scan.completed':
        this.write(
          this.paint(
            `\nScan complete in ${seconds(event.durationMs)} — ` +
              `${String(event.findingsTotal)} finding(s), $${event.costUsd.toFixed(4)}`,
            ANSI.green,
          ),
        );
        break;
      case 'scan.failed':
        this.write(this.paint(`\nScan failed — ${event.code}: ${event.message}`, ANSI.red));
        break;
      case 'log':
        if (!this.quiet || event.level === 'warn' || event.level === 'error') {
          this.write(this.paint(`  ${event.message}`, ANSI.dim));
        }
        break;
      default:
        break;
    }
  }
}
