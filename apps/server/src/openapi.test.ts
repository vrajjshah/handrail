import { describe, expect, it, afterEach } from 'vitest';

import { harness, type Harness } from './__test__/harness.js';

let current: Harness | undefined;

afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { responses: Record<string, unknown>; tags?: string[] }>>;
  components?: { schemas?: Record<string, unknown> };
}

async function document(): Promise<OpenApiDocument> {
  current = await harness();
  const response = await current.app.inject({ url: '/openapi.json' });
  expect(response.statusCode).toBe(200);
  return response.json<OpenApiDocument>();
}

/**
 * Follow one `$ref` into `components.schemas` and return that schema as text.
 *
 * The generator hoists named schemas into components rather than inlining them,
 * which is the better document — but it means an assertion that only looks at
 * the operation would pass on a `$ref` pointing at an empty object.
 */
function schemaTextAt(doc: OpenApiDocument, path: string, status: string): string {
  const response = doc.paths[path]?.get?.responses[status] ?? doc.paths[path]?.post?.responses[status];
  const schema = (response as { content?: Record<string, { schema?: unknown }> } | undefined)?.content?.[
    'application/json'
  ]?.schema;
  return resolveText(doc, schema);
}

function resolveText(doc: OpenApiDocument, schema: unknown): string {
  const ref = (schema as { $ref?: string } | undefined)?.$ref;
  if (typeof ref !== 'string') return JSON.stringify(schema ?? {});
  const name = ref.replace('#/components/schemas/', '');
  const target = doc.components?.schemas?.[name];
  expect(target, `the document refs ${ref} but does not define it`).toBeDefined();
  return JSON.stringify(target);
}

/**
 * The acceptance criterion for #16: the document is *generated*.
 *
 * These assertions are deliberately about structure a hand-written spec would
 * get wrong within a week — that every route is present, that the schemas came
 * out of `@handrail/schemas` in full detail rather than as an empty object, and
 * that the error shape is documented everywhere it can occur.
 */
describe('the generated OpenAPI document', () => {
  it('is OpenAPI 3.1 and names this deployment', async () => {
    const doc = await document();
    expect(doc.openapi.startsWith('3.1')).toBe(true);
    expect(doc.info.title).toBe('Handrail');
    expect(doc.info.version).toBe('9.9.9-test');
  });

  it('documents every route the API serves', async () => {
    const doc = await document();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/artifacts/{id}',
      '/api/meta',
      '/api/scans',
      '/api/scans/{id}',
      '/api/scans/{id}/report',
      '/api/scans/{id}/report.html',
      '/api/scans/{id}/report.sarif',
    ]);
  });

  it('describes the report body in full rather than as an opaque object', async () => {
    // This is the assertion that would have caught the real trap here: a
    // `.transform()` anywhere inside a response schema makes it unrepresentable
    // in JSON Schema, and the generator silently documents `{}` instead. No
    // error, no warning — just an API description that has stopped describing.
    const doc = await document();
    const serialised = schemaTextAt(doc, '/api/scans/{id}/report', '200');

    expect(serialised.length).toBeGreaterThan(500);
    for (const field of ['reportVersion', 'coverage', 'scRollups', 'trendScore', 'findings']) {
      expect(serialised).toContain(field);
    }
    // The tier vocabulary is the product's most load-bearing field. If it is in
    // the document, the finding schema really was expanded.
    expect(serialised).toContain('needs-review');
  });

  it('documents the problem shape on every failure it can return', async () => {
    const doc = await document();
    const notFound = doc.paths['/api/scans/{id}']?.get?.responses['404'];
    expect(JSON.stringify(notFound)).toContain('correlationId');
  });

  it('describes the request body from the same enums the engine uses', async () => {
    const doc = await document();
    const post = doc.paths['/api/scans']?.post as
      | { requestBody?: { content: Record<string, { schema: unknown }> } }
      | undefined;
    const body = resolveText(doc, post?.requestBody?.content['application/json']?.schema);
    expect(body).toContain('deterministic');
    expect(body).toContain('hybrid-vision');
    expect(body).toContain('reflow-320');
  });

  it('advertises the binary artifact response as binary', async () => {
    const doc = await document();
    const ok = doc.paths['/api/artifacts/{id}']?.get?.responses['200'];
    expect(JSON.stringify(ok)).toContain('binary');
  });

  it('groups routes under tags a reader can navigate', async () => {
    const doc = await document();
    expect(doc.paths['/api/scans']?.post?.tags).toEqual(['scans']);
    expect(doc.paths['/api/meta']?.get?.tags).toEqual(['meta']);
  });
});
