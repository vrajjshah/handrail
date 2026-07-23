import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPS_DIR = path.resolve(PACKAGES_DIR, '../apps');

interface WorkspacePackage {
  dir: string;
  name: string;
  dependencies: Record<string, string>;
}

async function readWorkspacePackages(root: string): Promise<WorkspacePackage[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const packages: WorkspacePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'package.json');
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch {
      continue;
    }
    const manifest = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    packages.push({
      dir: entry.name,
      name: manifest.name ?? entry.name,
      dependencies: { ...manifest.dependencies, ...manifest.devDependencies },
    });
  }
  return packages;
}

/**
 * The layering rule, asserted rather than trusted.
 *
 * From the plan: "Orchestrator nodes are one-line calls into engine steps, and
 * surfaces never import `@langchain/*`." That rule is the entire reason this
 * package exists — if a CLI or a server can reach for LangGraph directly, the
 * abstraction has failed and nobody finds out until the dependency is load-bearing.
 * A comment cannot catch that. This can.
 */
describe('the layering rule', () => {
  it('confines @langchain/* to @handrail/orchestrator', async () => {
    const all = [...(await readWorkspacePackages(PACKAGES_DIR)), ...(await readWorkspacePackages(APPS_DIR))];
    expect(all.length).toBeGreaterThan(1);

    const offenders = all
      .filter((pkg) => pkg.name !== '@handrail/orchestrator')
      .filter((pkg) => Object.keys(pkg.dependencies).some((dep) => dep.startsWith('@langchain/')))
      .map((pkg) => pkg.name);

    expect(offenders, 'only @handrail/orchestrator may depend on @langchain/*').toEqual([]);
  });

  it('still has the orchestrator itself depending on it, so the test can fail', async () => {
    const packages = await readWorkspacePackages(PACKAGES_DIR);
    const orchestrator = packages.find((pkg) => pkg.name === '@handrail/orchestrator');
    expect(orchestrator).toBeDefined();
    expect(Object.keys(orchestrator?.dependencies ?? {})).toContain('@langchain/langgraph');
  });
});
