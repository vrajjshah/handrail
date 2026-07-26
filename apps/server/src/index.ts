/**
 * `@handrail/server` — the hosted showcase's API.
 *
 * A surface, in the layering rule's sense: it composes `@handrail/engine` and
 * `@handrail/orchestrator` and never imports `@langchain/*` itself. The HTTP
 * contracts are the `@handrail/schemas` contracts, which is what makes the
 * OpenAPI document generated rather than written — and what makes an API that
 * has drifted from the engine a typecheck failure rather than a support ticket.
 */
export * from './config.js';
export * from './app.js';
export * from './http/problem.js';
export * from './http/schemas.js';
export * from './store/types.js';
export * from './store/memory.js';
export * from './store/stats.js';
export { HANDRAIL_VERSION } from './version.js';
