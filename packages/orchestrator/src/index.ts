/**
 * `@handrail/orchestrator` — the LangGraph scan graph.
 *
 * The layering rule this package exists to enforce: `@langchain/*` is a
 * dependency of this package and of nothing else. Nodes are one-line calls into
 * `@handrail/engine` steps, so a surface (CLI, server, action, MCP) can drive a
 * scan without ever importing an orchestration library.
 */
export const ORCHESTRATOR_PACKAGE = '@handrail/orchestrator';
