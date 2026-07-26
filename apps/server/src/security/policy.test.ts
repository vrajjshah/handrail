import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Trust invariant 6, asserted rather than promised: **never bypass bot
 * detection or CAPTCHAs.**
 *
 * A site that blocks us produces partial results and an honest coverage
 * statement — the `bot-protection` degradation exists for exactly that. It is
 * not a gap to be closed with a stealth plugin, and the reason is the product's
 * whole argument: a tool that lies to the site it is measuring has no standing
 * to tell anyone the truth about it. It is also, in most jurisdictions, the
 * line between a scanner and unauthorised access.
 *
 * The evasion ecosystem is a handful of well-known packages and a handful of
 * well-known Chromium flags. Both are cheap to check and neither arrives by
 * accident — this test exists so the decision has to be made deliberately, in a
 * pull request, by someone who has to delete an assertion to do it.
 */
const FORBIDDEN_DEPENDENCIES = [
  'puppeteer-extra-plugin-stealth',
  'playwright-extra',
  'puppeteer-extra',
  'playwright-stealth',
  'rebrowser-playwright',
  'undetected-chromedriver',
  '2captcha',
  'anticaptcha',
  '@2captcha/captcha-solver',
  'capsolver',
];

/** Flags whose only purpose is to make automation look like a person. */
const FORBIDDEN_LAUNCH_FLAGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-automation',
  'excludeSwitches',
];

async function packageManifests(): Promise<{ name: string; deps: string[] }[]> {
  const manifests: { name: string; deps: string[] }[] = [];
  for (const group of ['packages', 'apps']) {
    const dir = path.join(ROOT, group);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(path.join(dir, entry.name, 'package.json'), 'utf8');
        const manifest = JSON.parse(raw) as {
          name?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        manifests.push({
          name: manifest.name ?? entry.name,
          deps: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
        });
      } catch {
        continue;
      }
    }
  }
  return manifests;
}

describe('never bypass bot detection', () => {
  it('depends on no evasion or CAPTCHA-solving package', async () => {
    const manifests = await packageManifests();
    expect(manifests.length).toBeGreaterThan(5);

    const offenders = manifests.flatMap((manifest) =>
      manifest.deps
        .filter((dep) => FORBIDDEN_DEPENDENCIES.includes(dep))
        .map((dep) => `${manifest.name} depends on ${dep}`),
    );
    expect(offenders).toEqual([]);
  });

  it('launches Chromium with no anti-detection flags', async () => {
    // `launchChromium` is the only place a browser is opened, so it is the only
    // place such a flag could be introduced.
    const source = await readFile(
      path.join(ROOT, 'packages/engine/src/capture/browser.ts'),
      'utf8',
    );
    for (const flag of FORBIDDEN_LAUNCH_FLAGS) {
      expect(source, `browser.ts must not set ${flag}`).not.toContain(flag);
    }
  });

  it('keeps a degradation reason for being blocked, so a partial scan says so', async () => {
    // The honest alternative to evasion: report what could not be reached
    // rather than pretending to be someone else in order to reach it.
    const source = await readFile(path.join(ROOT, 'packages/schemas/src/scan.ts'), 'utf8');
    expect(source).toContain("'bot-protection'");
  });
});
