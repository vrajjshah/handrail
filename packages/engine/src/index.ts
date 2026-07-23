/**
 * Playwright's page handles, re-exported.
 *
 * `captureState`, `runAxeDetection` and `runHeuristics` all take a `Page`, so
 * the type is already part of this package's public surface — a caller that
 * cannot name it cannot write a function that passes one on. Re-exporting it
 * lets the orchestrator drive a browser through the engine without taking its
 * own dependency on Playwright, which is what keeps the dependency graph honest
 * about who owns the browser: this package does.
 */
export type { Browser, BrowserContext, Page } from 'playwright';

export * from './capture/types.js';
export * from './capture/state-capture.js';
export * from './capture/artifacts.js';
export * from './capture/signals.js';
export * from './capture/isolated-world.js';
export * from './capture/ax-tree.js';
export type {
  BrowserCollectorOptions,
  RawCollectorResult,
  RawElementRecord,
  RawMediaInventory,
} from './capture/element-index.browser.js';

export * from './detect/types.js';
export * from './detect/axe-detect.js';
export * from './detect/axe-runner.js';
export type { AxeResult, AxeResultGroup, AxeNode, AxeImpact } from './detect/axe-types.js';

export * from './judge/types.js';
export * from './judge/sanitize.js';
export * from './judge/element-extract.js';
export * from './judge/prompts.js';
export * from './judge/text-judge-schema.js';
export * from './judge/text-judge.js';
export * from './judge/run-text-judgment.js';

export * from './verdict/fuzzy.js';
export * from './verdict/grounding.js';
export * from './verdict/rechecks.js';
export * from './verdict/verifier.js';
export * from './verdict/ai-finding.js';
export * from './verdict/hallucination-ledger.js';
export * from './verdict/pipeline.js';

export * from './detect/heuristics/types.js';
export * from './detect/heuristics/run-heuristics.js';
export * from './detect/heuristics/ptr-target-size.js';
export * from './detect/heuristics/resp-reflow.js';
export * from './detect/heuristics/kbd-focus-order.js';
export * from './detect/heuristics/kbd-focus-visible.js';
export * from './detect/heuristics/keyboard-traversal.js';
export { buildHeuristicFinding } from './detect/heuristics/finding-builder.js';
export type { FocusStyle, ActiveElementInfo } from './detect/heuristics/read-active-element.browser.js';
