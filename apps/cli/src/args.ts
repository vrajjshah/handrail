import {
  ScanModeSchema,
  ViewportLabelSchema,
  type ScanMode,
  type Tier,
  type Viewport,
  type ViewportLabel,
  type WcagLevel,
} from '@handrail/schemas';

/**
 * The viewport matrix, by label.
 *
 * Sizes are the plan's: `desktop` runs full, `mobile` is a real phone box rather
 * than a narrow desktop (device scale factor 2 matters — a screenshot at 1× is
 * not what the user sees), and `reflow-320` is the width 1.4.10 names.
 */
export const VIEWPORT_PRESETS: Partial<Record<ViewportLabel, Viewport>> = {
  desktop: { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { label: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  'reflow-320': { label: 'reflow-320', width: 320, height: 800, deviceScaleFactor: 1 },
};

export type ReportFormat = 'html' | 'json';

/** What a `handrail scan` invocation resolves to. */
export interface ScanArgs {
  command: 'scan';
  url: string;
  mode: ScanMode;
  report: ReportFormat;
  outDir: string;
  budgetUsd: number | undefined;
  viewports: Viewport[];
  level: WcagLevel;
  /** Exit non-zero when a finding at this tier or higher exists. `undefined` never fails. */
  failOn: Tier | undefined;
  navigationTimeoutMs: number;
  screenshots: boolean;
  open: boolean;
  quiet: boolean;
  /** Emit the raw event stream as NDJSON on stdout, for piping into something else. */
  ndjson: boolean;
}

export type ParsedArgs =
  | ScanArgs
  | { command: 'help'; topic?: string }
  | { command: 'version' };

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const TIERS = new Set<string>(['violation', 'likely', 'needs-review']);

export const HELP = `handrail — the open-source AI accessibility engineer

Usage
  handrail scan <url> [options]

Options
  --mode <mode>            deterministic | hybrid | hybrid-vision   (default: deterministic)
  --report <format>        html | json                              (default: html)
                           report.json is always written; "html" adds report.html.
  --out <dir>              where the report is written              (default: ./handrail-report)
  --budget-usd <n>         hard spend cap for this scan; the scan degrades rather than overrun
  --viewports <list>       comma-separated: desktop, mobile, reflow-320  (default: desktop)
  --level <A|AA>           WCAG conformance target                  (default: AA)
  --fail-on <tier>         violation | likely | needs-review — exit 2 if any finding reaches it
  --timeout-ms <n>         per-page navigation timeout              (default: 30000)
  --no-screenshots         skip screenshot capture and evidence crops
  --open                   open report.html when the scan finishes
  --ndjson                 stream raw scan events as NDJSON on stdout
  --quiet                  only print the summary
  -h, --help               show this
  -v, --version            print the version

Modes
  deterministic  rules and heuristics only. No model client is constructed, no
                 network is reached beyond the page itself, and it costs $0.
  hybrid         adds batched LLM text judgment. Needs ANTHROPIC_API_KEY, or
                 HANDRAIL_PROVIDER=bedrock with AWS credentials.
  hybrid-vision  adds vision judgment. Not implemented yet (Phase 3) — it runs
                 as hybrid and the report records the gap.

Examples
  handrail scan https://example.com
  handrail scan https://example.com --mode hybrid --report html --out ./out
  handrail scan https://example.com --viewports desktop,mobile,reflow-320 --fail-on violation
`;

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

function parseNumber(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new UsageError(`${flag} needs a non-negative number, got "${raw}"`);
  }
  return value;
}

function parseViewports(raw: string): Viewport[] {
  const labels = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (labels.length === 0) throw new UsageError('--viewports needs at least one label');

  return labels.map((label) => {
    const parsed = ViewportLabelSchema.safeParse(label);
    const preset = parsed.success ? VIEWPORT_PRESETS[parsed.data] : undefined;
    if (preset === undefined) {
      throw new UsageError(
        `unknown viewport "${label}" — supported: ${Object.keys(VIEWPORT_PRESETS).join(', ')}`,
      );
    }
    return preset;
  });
}

/**
 * Parse `process.argv.slice(2)`.
 *
 * Hand-rolled, and deliberately: a CLI that shells out to nothing and takes a
 * dozen flags does not need an argument-parsing dependency, and the alternative
 * is a supply-chain entry in a tool whose pitch is that you can audit it. Every
 * branch below is unit-tested, which is the trade.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { command: 'help' };

  const [first, ...rest] = argv;
  if (first === '--help' || first === '-h' || first === 'help') {
    return rest[0] === undefined ? { command: 'help' } : { command: 'help', topic: rest[0] };
  }
  if (first === '--version' || first === '-v') return { command: 'version' };
  if (first !== 'scan') throw new UsageError(`unknown command "${String(first)}" — try \`handrail scan <url>\``);

  const args: ScanArgs = {
    command: 'scan',
    url: '',
    mode: 'deterministic',
    report: 'html',
    outDir: 'handrail-report',
    budgetUsd: undefined,
    viewports: [presetOrThrow('desktop')],
    level: 'AA',
    failOn: undefined,
    navigationTimeoutMs: 30_000,
    screenshots: true,
    open: false,
    quiet: false,
    ndjson: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) continue;

    switch (token) {
      case '--mode': {
        const value = requireValue(token, rest[++index]);
        const parsed = ScanModeSchema.safeParse(value);
        if (!parsed.success) {
          throw new UsageError(
            `unknown mode "${value}" — expected ${ScanModeSchema.options.join(', ')}`,
          );
        }
        args.mode = parsed.data;
        break;
      }
      case '--report': {
        const value = requireValue(token, rest[++index]);
        if (value !== 'html' && value !== 'json') {
          throw new UsageError(`unknown report format "${value}" — expected html or json`);
        }
        args.report = value;
        break;
      }
      case '--out':
        args.outDir = requireValue(token, rest[++index]);
        break;
      case '--budget-usd':
        args.budgetUsd = parseNumber(token, requireValue(token, rest[++index]));
        break;
      case '--viewports':
        args.viewports = parseViewports(requireValue(token, rest[++index]));
        break;
      case '--level': {
        const value = requireValue(token, rest[++index]);
        if (value !== 'A' && value !== 'AA') {
          throw new UsageError(`unknown level "${value}" — expected A or AA`);
        }
        args.level = value;
        break;
      }
      case '--fail-on': {
        const value = requireValue(token, rest[++index]);
        if (value === 'none') break;
        if (!TIERS.has(value)) {
          throw new UsageError(
            `unknown tier "${value}" — expected violation, likely, needs-review or none`,
          );
        }
        args.failOn = value as Tier;
        break;
      }
      case '--timeout-ms':
        args.navigationTimeoutMs = parseNumber(token, requireValue(token, rest[++index]));
        break;
      case '--no-screenshots':
        args.screenshots = false;
        break;
      case '--open':
        args.open = true;
        break;
      case '--ndjson':
        args.ndjson = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        return { command: 'help' };
      default:
        if (token.startsWith('-')) throw new UsageError(`unknown option "${token}"`);
        if (args.url !== '') throw new UsageError(`unexpected extra argument "${token}"`);
        args.url = token;
    }
  }

  if (args.url === '') throw new UsageError('scan needs a url — `handrail scan https://example.com`');
  args.url = normaliseUrl(args.url);
  return args;
}

function presetOrThrow(label: ViewportLabel): Viewport {
  const preset = VIEWPORT_PRESETS[label];
  if (preset === undefined) throw new Error(`no viewport preset for ${label}`);
  return preset;
}

/**
 * Accepts `example.com` and means `https://example.com`, because everybody types
 * it that way — but never silently upgrades a scheme the user did type, and
 * refuses anything that is not http(s). A scanner pointed at `file://` is a
 * local-file read with extra steps.
 */
export function normaliseUrl(raw: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UsageError(`"${raw}" is not a url`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`handrail only scans http(s) urls, got "${url.protocol}//"`);
  }
  return url.toString();
}
