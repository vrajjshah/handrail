/**
 * The smoke gate's entry point, kept separate from its logic.
 *
 * `smoke.ts` has no side effects so its tests can import it; this file ends in
 * a call and must never be imported by one. That rule is written in AGENTS.md
 * because the repo has already been bitten by a test that ran the generator it
 * was checking.
 */
import { SmokeFailure, defaultOptions, runSmoke } from './smoke.js';

const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL;
if (baseUrl === undefined || baseUrl.length === 0) {
  process.stderr.write('usage: smoke <base-url>   (or set SMOKE_BASE_URL)\n');
  process.exit(1);
}

try {
  await runSmoke(defaultOptions(baseUrl, process.env));
  process.stdout.write('smoke: deployment is healthy\n');
} catch (error) {
  const step = error instanceof SmokeFailure ? error.step : 'unknown';
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`smoke: FAILED at ${step} — ${message}\n`);
  // Non-zero is what `deploy.yml` turns into a rollback.
  process.exit(1);
}
