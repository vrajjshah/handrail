import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export interface FixtureServer {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Serves the built seeded-demo over http.
 *
 * Deliberately a real server on a real origin rather than `page.setContent`:
 * the capture reads document coordinates, computed styles and the accessibility
 * tree, and a `data:` or `about:blank` document does not exercise the same paths
 * — relative asset URLs and same-origin rules included.
 *
 * Lives next to `capture-seeded-demo.ts` rather than under a `__test__/` folder
 * because that generator imports it, so it has to be a module the build keeps.
 * `tsconfig.build.json` drops every `__test__/**` path; a shared helper sitting
 * in one would have been compiled into `dist` purely to keep the generator
 * building. Same reasoning as `seeded-demo-fixture.ts`.
 */
export async function serveSeededDemo(): Promise<FixtureServer> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = normalize(join(here, '..', '..', '..', '..', 'fixtures', 'apps', 'seeded-demo', 'dist'));

  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(
      `seeded-demo is not built at ${root}. Run: pnpm --filter @handrail/fixture-seeded-demo build`,
    );
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = normalize(join(root, relative));

    // Path traversal would only hurt the test runner, but a fixture server that
    // serves outside its root is a bad habit to leave lying around a scanner repo.
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port');

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
