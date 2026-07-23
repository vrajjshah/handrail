import { z } from 'zod';

/**
 * A WCAG success-criterion number, e.g. "1.4.3", "2.4.11".
 *
 * The authoritative catalogue of *which* criteria exist lives in `@handrail/wcag`.
 * This package sits below that one in the layering rule, so it validates shape only.
 */
export const ScIdSchema = z
  .string()
  .regex(/^\d\.\d\.\d{1,2}$/, 'expected a WCAG SC number like "1.4.3"')
  .brand<'ScId'>();
export type ScId = z.infer<typeof ScIdSchema>;

/** WCAG conformance level. Handrail targets A and AA; AAA is out of scope. */
export const WcagLevelSchema = z.enum(['A', 'AA']);
export type WcagLevel = z.infer<typeof WcagLevelSchema>;

/** Stable identifier for a check implementation, e.g. "kbd.walk", "axe.image-alt". */
export const CheckIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*\.[a-z0-9-]+$/, 'expected a check id like "kbd.walk"');
export type CheckId = z.infer<typeof CheckIdSchema>;

/**
 * Identifier for one captured page state (URL + viewport + interaction path).
 * The unit of "capture once, judge many".
 */
export const PageStateIdSchema = z.string().min(1).brand<'PageStateId'>();
export type PageStateId = z.infer<typeof PageStateIdSchema>;

/** Identifier for one element inside a captured state's element index. */
export const ElementIdSchema = z.string().min(1).brand<'ElementId'>();
export type ElementId = z.infer<typeof ElementIdSchema>;

/** Identifier for a stored binary artifact (screenshot, crop, trace). */
export const ArtifactIdSchema = z.string().min(1).brand<'ArtifactId'>();
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;

export const ScanIdSchema = z.string().min(1).brand<'ScanId'>();
export type ScanId = z.infer<typeof ScanIdSchema>;

export const FindingIdSchema = z.string().min(1).brand<'FindingId'>();
export type FindingId = z.infer<typeof FindingIdSchema>;

/** Pixel-space rectangle in the coordinate system of its page state's full-page screenshot. */
export const BoundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

/**
 * Named viewport. The labels correspond to the viewport matrix in the engine:
 * `desktop` runs full, `mobile` runs the A+B subset, and the rest are targeted
 * at the criteria that need them.
 */
export const ViewportLabelSchema = z.enum([
  'desktop',
  'mobile',
  'reflow-320',
  'zoom-200',
  'dark',
  'forced-colors',
  'reduced-motion',
]);
export type ViewportLabel = z.infer<typeof ViewportLabelSchema>;

export const ViewportSchema = z.object({
  label: ViewportLabelSchema,
  width: z.int().positive(),
  height: z.int().positive(),
  deviceScaleFactor: z.number().positive().default(1),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** Confidence in the unit interval. Deterministic sources report 1. */
export const ConfidenceSchema = z.number().min(0).max(1);

export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

/** Cost in US dollars. Always recorded, even when zero. */
export const CostUsdSchema = z.number().nonnegative();

/**
 * Constructors for the branded ids above.
 *
 * The brands exist so that a `ScanId` can never be passed where a `FindingId`
 * belongs — a genuine hazard once six kinds of identifier are in flight. These
 * helpers are the only sanctioned way to mint one from a plain string, and they
 * validate on the way through.
 */
export const scId = (value: string): ScId => ScIdSchema.parse(value);
export const pageStateId = (value: string): PageStateId => PageStateIdSchema.parse(value);
export const elementId = (value: string): ElementId => ElementIdSchema.parse(value);
export const artifactId = (value: string): ArtifactId => ArtifactIdSchema.parse(value);
export const scanId = (value: string): ScanId => ScanIdSchema.parse(value);
export const findingId = (value: string): FindingId => FindingIdSchema.parse(value);
