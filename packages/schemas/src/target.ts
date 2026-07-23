import { z } from 'zod';

import { CostUsdSchema, type Viewport, ViewportSchema, WcagLevelSchema } from './primitives.js';

/**
 * Authentication for scanning pages behind a login.
 *
 * Credentials are referenced by environment variable name, never stored inline —
 * a scan target is a committed config file in most real setups.
 */
export const LoginStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), url: z.url() }),
  z.object({
    action: z.literal('fill'),
    selector: z.string().min(1),
    valueFromEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'expected an env var name'),
  }),
  z.object({ action: z.literal('click'), selector: z.string().min(1) }),
  z.object({
    action: z.literal('waitFor'),
    selector: z.string().min(1).optional(),
    urlPattern: z.string().min(1).optional(),
    timeoutMs: z.int().positive().max(120_000).default(30_000),
  }),
]);
export type LoginStep = z.infer<typeof LoginStepSchema>;

export const ScanAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('storage-state'), path: z.string().min(1) }),
  z.object({ kind: z.literal('login-steps'), steps: z.array(LoginStepSchema).min(1) }),
]);
export type ScanAuth = z.infer<typeof ScanAuthSchema>;

/**
 * Crawl caps. Handrail is a good citizen by default: same origin, modest page
 * count, and template dedupe so that 400 product pages cost two captures.
 */
export const CrawlConfigSchema = z.object({
  maxPages: z.int().positive().max(500).default(5),
  maxDepth: z.int().nonnegative().max(10).default(3),
  sameOriginOnly: z.boolean().default(true),
  useSitemap: z.boolean().default(true),
  /** Collapse `/products/1234` and `/products/5678` into one template. */
  templateDedupe: z
    .object({
      enabled: z.boolean().default(true),
      perTemplate: z.int().positive().max(10).default(2),
    })
    .prefault({}),
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
});
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

/** Hard ceilings for one scan. Exceeding any of these degrades the scan rather than overrunning. */
export const ScanBudgetSchema = z.object({
  maxUsd: CostUsdSchema.default(1.5),
  maxDurationMs: z.int().positive().default(600_000),
  maxModelTokens: z.int().positive().default(2_000_000),
});
export type ScanBudget = z.infer<typeof ScanBudgetSchema>;

const DEFAULT_VIEWPORTS: Viewport[] = [
  { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  { label: 'mobile', width: 390, height: 844, deviceScaleFactor: 2 },
  { label: 'reflow-320', width: 320, height: 800, deviceScaleFactor: 1 },
];

const ScanTargetCommon = {
  viewports: z.array(ViewportSchema).min(1).default(DEFAULT_VIEWPORTS),
  budget: ScanBudgetSchema.prefault({}),
  auth: ScanAuthSchema.optional(),
  /** Human label used in reports and PR comments. */
  name: z.string().min(1).max(200).optional(),
};

export const ScanTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    url: z.url(),
    crawl: CrawlConfigSchema.prefault({}),
    ...ScanTargetCommon,
  }),
  z.object({
    kind: z.literal('repo'),
    /** Repository root on disk. Fixes are written here, inside a git worktree sandbox. */
    path: z.string().min(1),
    /** How to bring the app up so it can be captured. */
    startCommand: z.string().min(1),
    baseUrl: z.url(),
    readyTimeoutMs: z.int().positive().max(600_000).default(120_000),
    crawl: CrawlConfigSchema.prefault({}),
    ...ScanTargetCommon,
  }),
]);
export type ScanTarget = z.infer<typeof ScanTargetSchema>;
export type ScanTargetInput = z.input<typeof ScanTargetSchema>;

/**
 * Scan modes.
 *
 * - `deterministic`  — rules and heuristics only. Offline, $0, always available.
 * - `hybrid`         — adds batched LLM text judgment.
 * - `hybrid-vision`  — adds vision judgment for the criteria that need eyes.
 */
export const ScanModeSchema = z.enum(['deterministic', 'hybrid', 'hybrid-vision']);
export type ScanMode = z.infer<typeof ScanModeSchema>;

export const WcagTargetSchema = z.object({
  version: z.literal('2.2').default('2.2'),
  level: WcagLevelSchema.default('AA'),
});

export const ScanOptionsSchema = z.object({
  mode: ScanModeSchema.default('deterministic'),
  wcagTarget: WcagTargetSchema.prefault({}),
  /** Attempt verified fixes. Only meaningful for `repo` targets. */
  fix: z.boolean().default(false),
  /** Per-run spend cap. The effective ceiling is `min(this, target.budget.maxUsd)`. */
  budgetUsd: CostUsdSchema.optional(),
  /** Ask a second rule engine (IBM equal-access) for a ceiling-limited second opinion. */
  secondOpinion: z.boolean().default(false),
});
export type ScanOptions = z.infer<typeof ScanOptionsSchema>;
export type ScanOptionsInput = z.input<typeof ScanOptionsSchema>;

/** The spend ceiling actually in force for a scan. */
export function effectiveBudgetUsd(target: ScanTarget, options: ScanOptions): number {
  return options.budgetUsd === undefined
    ? target.budget.maxUsd
    : Math.min(options.budgetUsd, target.budget.maxUsd);
}
