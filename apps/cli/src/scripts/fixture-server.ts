import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = normalize(join(HERE, '..', '..', '..', '..'));
export const FIXTURE_DIST = join(REPO_ROOT, 'fixtures', 'apps', 'seeded-demo', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export interface ServedFixture {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Serve the built seeded-demo on a **fixed** port.
 *
 * Fixed rather than ephemeral because the scanned URL is hashed into
 * `pageStateId`, which is hashed into every finding id: a moving port makes
 * every id churn between runs, which would render both the golden snapshot and
 * the recall baseline unreadable as diffs.
 */
export async function serveFixture(port: number): Promise<ServedFixture> {
  if (!existsSync(join(FIXTURE_DIST, 'index.html'))) {
    throw new Error(
      `seeded-demo is not built at ${FIXTURE_DIST}.\n` +
        'Run: pnpm --filter @handrail/fixture-seeded-demo build',
    );
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    // Normalise before the containment check: a `..` must not escape the root.
    const file = normalize(join(FIXTURE_DIST, relative));
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
          ? new Error(`port ${String(port)} is in use, and this run needs it specifically.`)
          : error,
      );
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    origin: `http://127.0.0.1:${String(port)}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
