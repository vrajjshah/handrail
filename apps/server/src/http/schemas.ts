import {
  ScanModeSchema,
  ScanRecordSchema,
  ViewportLabelSchema,
  WcagLevelSchema,
} from '@handrail/schemas';
import { z } from 'zod';

/**
 * The HTTP surface, expressed in the same Zod contracts the engine uses.
 *
 * Request bodies are *narrower* than `ScanTarget`/`ScanOptions` on purpose. The
 * hosted demo is a stranger-facing service: it decides its own crawl caps,
 * budgets and viewports, and it is not going to let a request set them. #19
 * enforces those ceilings; this schema is the reason a request cannot even ask.
 */
export const CreateScanBodySchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(2048).meta({
      description: 'The page to scan. http and https only; the SSRF guard has the last word.',
      example: 'https://example.com',
    }),
    mode: ScanModeSchema.default('deterministic').meta({
      description: 'deterministic is free and offline. hybrid adds batched text judgment.',
    }),
    level: WcagLevelSchema.default('AA'),
    viewports: z
      .array(ViewportLabelSchema)
      .min(1)
      .max(3)
      .default(['desktop', 'mobile', 'reflow-320'])
      .meta({ description: 'Which of the viewport presets to capture.' }),
  })
  .meta({ id: 'CreateScanRequest' });
export type CreateScanBody = z.infer<typeof CreateScanBodySchema>;

export const ScanIdParamsSchema = z.object({
  id: z.string().min(1).max(200).meta({ example: 'scan_9f1c…' }),
});

export const ArtifactIdParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(200)
    // Artifact ids are content-addressed (`<kind>_<sha256 prefix>`) and this
    // route reads them straight off a filesystem store. Constraining the shape
    // here is what stops `../` ever reaching a path join.
    .regex(/^[a-z][a-z0-9-]*_[a-f0-9]{8,64}$/, 'expected an artifact id like "full_a1b2c3d4"'),
});

export const ScanResponseSchema = ScanRecordSchema.meta({ id: 'Scan' });

/** What `POST /api/scans` answers with: the record, plus where to watch it. */
export const CreateScanResponseSchema = z
  .object({
    scan: ScanResponseSchema,
    links: z.object({
      self: z.string(),
      events: z.string(),
      report: z.string(),
    }),
  })
  .meta({ id: 'CreateScanResponse' });

/**
 * The SARIF envelope.
 *
 * Only the envelope is described, and the runs pass through loose. A full
 * transcription of SARIF 2.1.0 into Zod would be several hundred lines that
 * duplicate a published JSON Schema, and the copy would be the thing that rots
 * — `$schema` already points every consumer at the authoritative definition.
 * What this *does* guarantee is that the version is 2.1.0 and there is a run.
 */
export const SarifResponseSchema = z
  .looseObject({
    $schema: z.string(),
    version: z.literal('2.1.0'),
    runs: z.array(z.looseObject({})).min(1),
  })
  .meta({ id: 'SarifLog' });

/**
 * A binary body.
 *
 * Fastify skips serialization entirely for a `Buffer` payload, so this schema
 * never runs — it exists to describe the response in the OpenAPI document,
 * where `type: string, format: binary` is how a byte stream is spelled.
 */
export const BinaryResponseSchema = z
  .any()
  .meta({ type: 'string', format: 'binary', description: 'PNG image bytes.' });

export const MetaResponseSchema = z
  .object({
    tool: z.object({ name: z.literal('handrail'), version: z.string() }),
    wcag: z.object({
      version: z.literal('2.2'),
      criteriaTotal: z.int(),
      levelA: z.int(),
      levelAA: z.int(),
      /** How many criteria any automated check speaks to at all. Honest coverage, at rest. */
      withAutomatedCoverage: z.int(),
    }),
    modes: z.array(ScanModeSchema),
    scans: z.object({
      total: z.int().nonnegative(),
      completed: z.int().nonnegative(),
      failed: z.int().nonnegative(),
      running: z.int().nonnegative(),
      durationMs: z.object({
        p50: z.number().nullable(),
        p95: z.number().nullable(),
      }),
      findingsTotal: z.int().nonnegative(),
      costUsdTotal: z.number().nonnegative(),
    }),
  })
  .meta({ id: 'Meta' });
