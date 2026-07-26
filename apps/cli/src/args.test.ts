import { describe, expect, it } from 'vitest';

import { HELP, UsageError, normaliseUrl, parseArgs, type ScanArgs } from './args.js';

function scan(argv: string[]): ScanArgs {
  const parsed = parseArgs(argv);
  if (parsed.command !== 'scan') throw new Error(`expected a scan, got ${parsed.command}`);
  return parsed;
}

describe('parseArgs', () => {
  it('defaults to a deterministic, html, desktop-only, never-failing scan', () => {
    const args = scan(['scan', 'https://example.com/']);
    expect(args.mode).toBe('deterministic');
    expect(args.report).toBe('html');
    expect(args.outDir).toBe('handrail-report');
    expect(args.viewports.map((v) => v.label)).toEqual(['desktop']);
    expect(args.level).toBe('AA');
    expect(args.failOn).toBeUndefined();
    expect(args.budgetUsd).toBeUndefined();
    expect(args.screenshots).toBe(true);
  });

  it('reads the flags the issue names', () => {
    const args = scan([
      'scan',
      'https://example.com/',
      '--mode',
      'hybrid',
      '--report',
      'json',
      '--out',
      './out',
      '--budget-usd',
      '0.5',
    ]);
    expect(args.mode).toBe('hybrid');
    expect(args.report).toBe('json');
    expect(args.outDir).toBe('./out');
    expect(args.budgetUsd).toBe(0.5);
  });

  it('expands the viewport matrix from labels', () => {
    const args = scan(['scan', 'https://example.com/', '--viewports', 'desktop,mobile,reflow-320']);
    expect(args.viewports.map((v) => v.label)).toEqual(['desktop', 'mobile', 'reflow-320']);
    // A mobile capture at 1× is not what a phone user sees.
    expect(args.viewports[1]?.deviceScaleFactor).toBe(2);
    expect(args.viewports[2]?.width).toBe(320);
  });

  it('rejects a viewport it has no preset for', () => {
    expect(() => scan(['scan', 'https://example.com/', '--viewports', 'watch'])).toThrow(UsageError);
    // A real label with no preset is still rejected rather than silently dropped.
    expect(() => scan(['scan', 'https://example.com/', '--viewports', 'dark'])).toThrow(/unknown viewport/);
  });

  it('takes a bare hostname to mean https', () => {
    expect(scan(['scan', 'example.com']).url).toBe('https://example.com/');
  });

  it('refuses a scheme that is not http(s)', () => {
    expect(() => normaliseUrl('file:///etc/passwd')).toThrow(/only scans http/);
    expect(() => normaliseUrl('javascript:alert(1)')).toThrow(/only scans http/);
  });

  it('accepts --fail-on none as "never fail"', () => {
    expect(scan(['scan', 'example.com', '--fail-on', 'none']).failOn).toBeUndefined();
    expect(scan(['scan', 'example.com', '--fail-on', 'violation']).failOn).toBe('violation');
    expect(() => scan(['scan', 'example.com', '--fail-on', 'critical'])).toThrow(UsageError);
  });

  it('complains about a flag with no value rather than swallowing the next flag', () => {
    expect(() => scan(['scan', 'example.com', '--out', '--quiet'])).toThrow(/--out needs a value/);
  });

  it('rejects unknown options and stray arguments', () => {
    expect(() => scan(['scan', 'example.com', '--turbo'])).toThrow(/unknown option/);
    expect(() => scan(['scan', 'example.com', 'also.com'])).toThrow(/extra argument/);
    expect(() => parseArgs(['fix', 'example.com'])).toThrow(/unknown command/);
  });

  it('needs a url', () => {
    expect(() => parseArgs(['scan'])).toThrow(/needs a url/);
  });

  it('handles help and version without a url', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-v']).command).toBe('version');
    expect(HELP).toContain('handrail scan <url>');
    // The help text has to state the $0 promise, since that is the acceptance.
    expect(HELP).toContain('costs $0');
  });
});
