/**
 * The golden scan.
 *
 *   pnpm --filter @handrail/cli golden:scan            # check (what CI runs)
 *   pnpm --filter @handrail/cli golden:scan --update   # re-record after an intended change
 *
 * A full deterministic scan of the seeded-demo, normalised and diffed against a
 * committed snapshot. This catches orchestration and report-shape drift that no
 * unit test sees: a node running out of order, an event vanishing from the
 * stream, a rollup status flipping. Screenshots are off — PNG bytes are the one
 * genuinely unstable output, and the snapshot is about shape, not pixels.
 */
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScan } from '@handrail/orchestrator';
import { createPlaywrightDriver } from '@handrail/orchestrator';
import { ScanOptionsSchema, ScanTargetSchema, scanId } from '@handrail/schemas';
import { chromium } from 'playwright';

import { buildSnapshot, describeDiff, serializeSnapshot } from '../golden.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = normalizePath(join(HERE, '..', '..', '..', '..'));
const FIXTURE_DIST = join(REPO_ROOT, 'fixtures', 'apps', 'seeded-demo', 'dist');
const GOLDEN_FILE = join(REPO_ROOT, 'fixtures', 'golden', 'seeded-demo.snapshot.json');

/**
 * A fixed port, deliberately, where an ephemeral one would be the obvious choice.
 *
 * The scanned URL is hashed into `pageStateId`, which is hashed into every
 * finding id, so `listen(0)` makes the entire snapshot churn on every run. The
 * alternative — normalising the port away — would also erase those content
 * hashes, and they are worth diffing: a finding id changing means its check or
 * its xpath changed, which is exactly the drift this gate is for.
 */
const GOLDEN_PORT = 5179;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

async function serveFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  if (!existsSync(join(FIXTURE_DIST, 'index.html'))) {
    throw new Error(
      `seeded-demo is not built at ${FIXTURE_DIST}.\n` +
        'Run: pnpm --filter @handrail/fixture-seeded-demo build',
    );
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    // Normalise before joining: a `..` in the request must not escape the root.
    const file = normalizePath(join(FIXTURE_DIST, relative));
    if (!file.startsWith(FIXTURE_DIST) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `port ${String(GOLDEN_PORT)} is in use, and the golden scan needs it specifically ` +
                '(the URL is hashed into every finding id). Free it and re-run.',
            )
          : error,
      );
    });
    server.listen(GOLDEN_PORT, '127.0.0.1', resolve);
  });

  return {
    origin: `http://127.0.0.1:${String(GOLDEN_PORT)}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');

  const fixture = await serveFixture();
  const browser = await chromium.launch();
  let actual: string;

  try {
    const driver = createPlaywrightDriver(browser);
    const result = await runScan(
      {
        // Fixed id: the snapshot must not change because a uuid did. The
        // normaliser scrubs it anyway; this makes a raw run readable too.
        scanId: scanId('scan_golden'),
        target: ScanTargetSchema.parse({
          kind: 'url',
          url: fixture.origin,
          viewports: [{ label: 'desktop', width: 1280, height: 800 }],
        }),
        options: ScanOptionsSchema.parse({ mode: 'deterministic' }),
      },
      { driver },
    );
    actual = serializeSnapshot(buildSnapshot(result.events, result.report));
  } finally {
    await browser.close();
    await fixture.close();
  }

  if (update) {
    await writeFile(GOLDEN_FILE, actual, 'utf8');
    console.log(`updated ${GOLDEN_FILE}`);
    return;
  }

  let expected: string;
  try {
    expected = await readFile(GOLDEN_FILE, 'utf8');
  } catch {
    console.error(
      `no golden committed at ${GOLDEN_FILE}.\n` +
        'Run: pnpm --filter @handrail/cli golden:scan --update',
    );
    process.exitCode = 1;
    return;
  }

  if (expected === actual) {
    console.log('golden scan matches the committed snapshot');
    return;
  }

  console.error('The golden scan no longer matches the committed snapshot.\n');
  console.error(describeDiff(expected, actual));
  console.error(
    '\nIf this change was intended, re-record it in the same PR:\n' +
      '  pnpm --filter @handrail/fixture-seeded-demo build\n' +
      '  pnpm --filter @handrail/cli golden:scan --update\n' +
      'and commit the updated snapshot so the diff is reviewed alongside the change.',
  );
  process.exitCode = 1;
}

await main();
