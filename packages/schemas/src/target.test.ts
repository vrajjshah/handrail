import { describe, expect, it } from 'vitest';

import {
  ScanOptionsSchema,
  ScanTargetSchema,
  effectiveBudgetUsd,
} from './target.js';

describe('ScanTargetSchema defaults', () => {
  it('gives a bare url target conservative crawl caps', () => {
    const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });

    expect(target.crawl.maxPages).toBe(5);
    expect(target.crawl.sameOriginOnly).toBe(true);
    expect(target.crawl.templateDedupe).toEqual({ enabled: true, perTemplate: 2 });
  });

  it('defaults to the desktop + mobile + reflow-320 viewport matrix', () => {
    const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });

    expect(target.viewports.map((v) => v.label)).toEqual(['desktop', 'mobile', 'reflow-320']);
  });

  it('caps spend at $1.50 and ten minutes unless overridden', () => {
    const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });

    expect(target.budget.maxUsd).toBe(1.5);
    expect(target.budget.maxDurationMs).toBe(600_000);
  });

  it('rejects a url target that is not a url', () => {
    expect(() => ScanTargetSchema.parse({ kind: 'url', url: 'not-a-url' })).toThrow();
  });

  it('requires a repo target to say how to start the app', () => {
    expect(() => ScanTargetSchema.parse({ kind: 'repo', path: '/srv/app' })).toThrow();
  });

  it('accepts a fully specified repo target', () => {
    const target = ScanTargetSchema.parse({
      kind: 'repo',
      path: '/srv/app',
      startCommand: 'pnpm dev',
      baseUrl: 'http://localhost:5173',
    });

    expect(target.kind).toBe('repo');
  });
});

describe('auth', () => {
  it('takes credentials by env var name, never inline', () => {
    const target = ScanTargetSchema.parse({
      kind: 'url',
      url: 'https://example.com/',
      auth: {
        kind: 'login-steps',
        steps: [
          { action: 'goto', url: 'https://example.com/login' },
          { action: 'fill', selector: '#password', valueFromEnv: 'DEMO_PASSWORD' },
          { action: 'click', selector: 'button[type=submit]' },
        ],
      },
    });

    expect(target.auth?.kind).toBe('login-steps');
  });

  it('rejects a fill step that tries to inline a secret', () => {
    expect(() =>
      ScanTargetSchema.parse({
        kind: 'url',
        url: 'https://example.com/',
        auth: {
          kind: 'login-steps',
          steps: [{ action: 'fill', selector: '#password', value: 'hunter2' }],
        },
      }),
    ).toThrow();
  });
});

describe('ScanOptionsSchema', () => {
  it('defaults to the free, offline, deterministic mode', () => {
    const options = ScanOptionsSchema.parse({});

    expect(options.mode).toBe('deterministic');
    expect(options.fix).toBe(false);
    expect(options.secondOpinion).toBe(false);
    expect(options.wcagTarget).toEqual({ version: '2.2', level: 'AA' });
  });

  it('rejects an unknown mode', () => {
    expect(() => ScanOptionsSchema.parse({ mode: 'yolo' })).toThrow();
  });
});

describe('effectiveBudgetUsd', () => {
  const target = ScanTargetSchema.parse({ kind: 'url', url: 'https://example.com/' });

  it('falls back to the target ceiling when the run sets none', () => {
    expect(effectiveBudgetUsd(target, ScanOptionsSchema.parse({}))).toBe(1.5);
  });

  it('honours a lower per-run cap', () => {
    expect(effectiveBudgetUsd(target, ScanOptionsSchema.parse({ budgetUsd: 0.25 }))).toBe(0.25);
  });

  it('never lets a run raise its cap above the target ceiling', () => {
    expect(effectiveBudgetUsd(target, ScanOptionsSchema.parse({ budgetUsd: 100 }))).toBe(1.5);
  });
});
