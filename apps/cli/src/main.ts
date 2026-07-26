#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserNotInstalledError } from '@handrail/engine';

import { HELP, UsageError, parseArgs } from './args.js';
import { colorEnabled } from './render.js';
import { runScanCommand } from './scan.js';
import { HANDRAIL_VERSION } from './version.js';

export interface CliIo {
  argv: readonly string[];
  /** Progress and diagnostics. stderr, so a piped stdout carries only `--ndjson`. */
  err: (line: string) => void;
  out: (line: string) => void;
  env: Record<string, string | undefined>;
  isTty: boolean;
}

/**
 * The whole CLI, as a function of its input.
 *
 * `main` takes its argv, its streams and its environment as arguments so the
 * exit codes and the output can be asserted without spawning anything. Nothing
 * below calls `process.exit`; the bin wrapper at the bottom does that once.
 *
 * Exit codes: **0** clean, **1** Handrail failed, **2** the site has findings at
 * or above `--fail-on`. Keeping "your site has problems" distinct from "the
 * scanner broke" is the difference between a CI gate and a flaky CI gate.
 */
export async function main(io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(io.argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`handrail: ${error.message}`);
      io.err('');
      io.err('Run `handrail --help` for usage.');
      return 1;
    }
    throw error;
  }

  if (parsed.command === 'help') {
    io.out(HELP);
    return 0;
  }
  if (parsed.command === 'version') {
    io.out(HANDRAIL_VERSION);
    return 0;
  }

  try {
    const result = await runScanCommand(parsed, {
      write: io.err,
      writeOut: io.out,
      env: io.env,
      color: colorEnabled(io.env, io.isTty),
    });
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`handrail: ${error.message}`);
      return 1;
    }
    if (error instanceof BrowserNotInstalledError) {
      io.err(`handrail: ${error.message}`);
      return 1;
    }
    io.err(`handrail: scan failed — ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack !== undefined && io.env.HANDRAIL_DEBUG !== undefined) {
      io.err(error.stack);
    }
    return 1;
  }
}

/** Only when run as a program, never when imported by a test. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = await main({
    argv: process.argv.slice(2),
    err: (line) => process.stderr.write(`${line}\n`),
    out: (line) => process.stdout.write(`${line}\n`),
    env: process.env,
    isTty: process.stdout.isTTY === true,
  });
}
