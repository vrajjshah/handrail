import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Where the built SPA lands. One image serves the app and the API, so the
 * public URL is the product rather than a bare `/api`.
 */
export const WEB_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../web/dist',
);

export async function webBuildExists(root = WEB_DIST): Promise<boolean> {
  try {
    await access(path.join(root, 'index.html'));
    return true;
  } catch {
    return false;
  }
}

/** Paths the API owns. A 404 under one of these is a problem document, never a page. */
const API_PREFIXES = ['/api', '/healthz', '/readyz', '/openapi.json'];

export function isApiPath(url: string): boolean {
  return API_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`));
}

/**
 * Serve `apps/web`'s build, if there is one.
 *
 * Absent in development and in every test, which is why it is conditional
 * rather than assumed: `pnpm --filter @handrail/web dev` serves the app on its
 * own port with hot reload, and a server that failed to start because a `dist`
 * it never needed was missing would be a strange way to find that out.
 *
 * Returns whether it is serving, because **Fastify permits exactly one
 * not-found handler per prefix** — so the SPA fallback cannot live here. It
 * lives in `app.ts`, with the API's, and this tells it which behaviour to use.
 */
export async function registerWebRoutes(
  app: FastifyInstance,
  options: { root?: string } = {},
): Promise<boolean> {
  const root = options.root ?? WEB_DIST;
  if (!(await webBuildExists(root))) {
    app.log.info({ root }, 'no web build found; serving the API only');
    return false;
  }

  await app.register(fastifyStatic, {
    root,
    // A route per file rather than one `/*`, so static serving cannot shadow
    // `/api` and an unknown path still reaches the not-found handler.
    wildcard: false,
    // Vite fingerprints every asset filename, so the bytes behind a name never
    // change and a year is safe. `index.html` is the exception — see below.
    maxAge: '1y',
    immutable: true,
  });

  app.log.info({ root }, 'serving the web build');
  return true;
}

/**
 * The SPA fallback: anything that is not an API path is a client-side route.
 *
 * `index.html` is never cached, or a deploy would keep serving the previous
 * bundle's asset filenames to everyone holding the old page.
 */
export function sendAppShell(request: FastifyRequest): boolean {
  return !isApiPath(request.url);
}
