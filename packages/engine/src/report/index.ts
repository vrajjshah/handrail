/**
 * `report/` — the per-SC rollup, the coverage ledger, and the artifacts rendered
 * from them.
 *
 * The rollup is the product. A number out of 100 is not: it hides which criteria
 * were checked, which could not be, and which nothing automated will ever settle.
 * Everything here is built so that the honest sentence — "automatically
 * evaluated N of 55 criteria" — is the only headline available.
 */
export * from './types.js';
export * from './rollup.js';
export * from './build-report.js';
export * from './html.js';
export * from './evidence-images.js';
