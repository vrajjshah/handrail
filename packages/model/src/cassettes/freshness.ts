import { type ModelRole } from '@handrail/schemas';

import { type Cassette, type CassetteIdentity } from './types.js';

export type StaleReason =
  /** The role still exists but its prompt has been revised since this recording. */
  | 'prompt-version-drift'
  /** Nothing in the codebase claims this role any more. */
  | 'unretained-role';

export interface StaleCassette {
  key: CassetteIdentity;
  reason: StaleReason;
  expectedPromptVersion: string | undefined;
}

/**
 * Find cassettes that no longer match the prompts in the codebase.
 *
 * A drifted `promptVersion` does not corrupt a replay — the version is part of
 * the key, so an updated prompt simply *misses* rather than replaying a stale
 * answer. What it does mean is that the corpus is now dead weight and the new
 * prompt has no coverage at all, which is the failure this check exists to make
 * visible: silently-uncovered prompts are how a "green" replay suite stops
 * testing anything.
 */
export function findStaleCassettes(
  cassettes: readonly Cassette[],
  currentPromptVersions: ReadonlyMap<ModelRole, string>,
): StaleCassette[] {
  const stale: StaleCassette[] = [];

  for (const cassette of cassettes) {
    const expected = currentPromptVersions.get(cassette.key.role);
    if (expected === undefined) {
      stale.push({ key: cassette.key, reason: 'unretained-role', expectedPromptVersion: undefined });
    } else if (expected !== cassette.key.promptVersion) {
      stale.push({
        key: cassette.key,
        reason: 'prompt-version-drift',
        expectedPromptVersion: expected,
      });
    }
  }

  return stale;
}

/** Roles that have current prompts but no cassette at all — uncovered by replay. */
export function findUncoveredRoles(
  cassettes: readonly Cassette[],
  currentPromptVersions: ReadonlyMap<ModelRole, string>,
): ModelRole[] {
  const covered = new Set(
    cassettes.map((cassette) => `${cassette.key.role}@${cassette.key.promptVersion}`),
  );
  return [...currentPromptVersions.entries()]
    .filter(([role, version]) => !covered.has(`${role}@${version}`))
    .map(([role]) => role);
}

export function describeStaleCassettes(stale: readonly StaleCassette[]): string {
  return stale
    .map((entry) =>
      entry.reason === 'prompt-version-drift'
        ? `${entry.key.role}: cassette promptVersion "${entry.key.promptVersion}" ≠ current "${entry.expectedPromptVersion ?? '?'}"`
        : `${entry.key.role}: no current prompt claims this role`,
    )
    .join('\n');
}
