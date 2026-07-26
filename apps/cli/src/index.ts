/**
 * `@handrail/cli` — the first surface.
 *
 * It composes and renders; it decides nothing. `streamScan` from
 * `@handrail/orchestrator` produces the events, `@handrail/engine` builds and
 * renders the report, and this package turns argv into a scan and the event
 * stream into something a person can watch. Per the layering rule it never
 * imports `@langchain/*`, and `layering.test.ts` in the orchestrator asserts it.
 */
export * from './args.js';
export * from './render.js';
export * from './model.js';
export * from './open.js';
export * from './scan.js';
export * from './version.js';
export { main, type CliIo } from './main.js';
