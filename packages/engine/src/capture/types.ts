import {
  ArtifactIdSchema,
  BoundingBoxSchema,
  ElementIdSchema,
  IsoTimestampSchema,
  PageStateIdSchema,
  ViewportSchema,
} from '@handrail/schemas';
import { z } from 'zod';

/**
 * The computed-style properties the judgment layers actually use.
 *
 * A deliberate subset, not everything: the full computed style of one element is
 * ~350 properties, and a page of 1,500 elements would be tens of megabytes that
 * nothing reads. Every property here is consumed by a named check.
 */
export const ComputedStyleSubsetSchema = z.object({
  color: z.string(),
  backgroundColor: z.string(),
  backgroundImage: z.string(),
  fontSize: z.string(),
  fontWeight: z.string(),
  display: z.string(),
  visibility: z.string(),
  opacity: z.string(),
  position: z.string(),
  overflowX: z.string(),
  overflowY: z.string(),
  whiteSpace: z.string(),
  cursor: z.string(),
  /** Focus-indicator inputs for kbd.focus-visible. */
  outlineStyle: z.string(),
  outlineWidth: z.string(),
  outlineColor: z.string(),
  outlineOffset: z.string(),
  boxShadow: z.string(),
  borderColor: z.string(),
  borderWidth: z.string(),
});
export type ComputedStyleSubset = z.infer<typeof ComputedStyleSubsetSchema>;

/**
 * One element in the index.
 *
 * The index is what the whole judgment layer reasons over, and what the verdict
 * pipeline grounds AI claims against: a model that names an `elemId` not present
 * here has hallucinated, and the claim is rejected rather than reported.
 */
export const ElementRecordSchema = z.object({
  elemId: ElementIdSchema,
  /** Document-order position. Deterministic, so a re-capture yields the same ids. */
  ordinal: z.int().nonnegative(),
  xpath: z.string().min(1),
  /** A CSS selector that resolves to exactly this element. */
  selector: z.string().min(1),
  tag: z.string().min(1),
  /**
   * Role and accessible name as **Chromium itself computed them**, read from the
   * CDP accessibility tree rather than reimplemented. Null when the element has
   * no accessibility node (typically because it is not rendered).
   */
  role: z.string().nullable(),
  accessibleName: z.string().nullable(),
  /** Null when the element has no layout box. */
  bbox: BoundingBoxSchema.nullable(),
  visible: z.boolean(),
  focusable: z.boolean(),
  tabIndex: z.int(),
  /** Trimmed own-text, capped. Null when the element has no direct text. */
  text: z.string().nullable(),
  /** Attributes the checks read. Not every attribute — see the browser collector. */
  attributes: z.record(z.string(), z.string()),
  style: ComputedStyleSubsetSchema,
});
export type ElementRecord = z.infer<typeof ElementRecordSchema>;

export const ConsoleErrorSchema = z.object({
  type: z.enum(['error', 'pageerror', 'requestfailed']),
  text: z.string(),
});
export type ConsoleError = z.infer<typeof ConsoleErrorSchema>;

/** What time-based and embedded content the page contains, for applicability. */
export const MediaInventorySchema = z.object({
  images: z.int().nonnegative(),
  imagesWithoutAlt: z.int().nonnegative(),
  decorativeImages: z.int().nonnegative(),
  svg: z.int().nonnegative(),
  canvas: z.int().nonnegative(),
  video: z.int().nonnegative(),
  audio: z.int().nonnegative(),
  autoplayingMedia: z.int().nonnegative(),
  mediaWithCaptionTrack: z.int().nonnegative(),
  iframes: z.int().nonnegative(),
  /** Embedded players we recognise but cannot inspect across the origin boundary. */
  thirdPartyMediaEmbeds: z.int().nonnegative(),
});
export type MediaInventory = z.infer<typeof MediaInventorySchema>;

/**
 * Something the capture could not do.
 *
 * Trust invariant 1 in miniature: a partial capture says so rather than looking
 * like a complete one. Anything downstream that reports a `pass` has to consider
 * these first.
 */
export const CaptureDegradationSchema = z.object({
  reason: z.enum([
    'ax-tree-unavailable',
    'screenshot-failed',
    'element-cap-reached',
    'dom-truncated',
    'navigation-timeout',
    'isolated-world-unavailable',
  ]),
  detail: z.string(),
});
export type CaptureDegradation = z.infer<typeof CaptureDegradationSchema>;

export const CaptureArtifactsSchema = z.object({
  fullPage: ArtifactIdSchema.nullable(),
  viewport: ArtifactIdSchema.nullable(),
});

/**
 * Document-level layout metrics, read once at capture time.
 *
 * `scrollWidth > clientWidth` is the ground truth for "this page scrolls
 * horizontally" — the signal `resp.reflow-320` decides 1.4.10 from. Recording it
 * in the capture keeps the reflow check a pure function over captured data rather
 * than something that has to drive the browser again.
 */
export const LayoutMetricsSchema = z.object({
  scrollWidth: z.number().nonnegative(),
  clientWidth: z.number().nonnegative(),
  scrollHeight: z.number().nonnegative(),
  clientHeight: z.number().nonnegative(),
});
export type LayoutMetrics = z.infer<typeof LayoutMetricsSchema>;

/**
 * One captured page state — the "capture once, judge many" unit.
 *
 * Every detection layer reads from this rather than driving the browser itself,
 * so a page is loaded and measured exactly once per viewport no matter how many
 * checks consume it.
 */
export const StateCaptureSchema = z.object({
  pageStateId: PageStateIdSchema,
  url: z.url(),
  title: z.string(),
  documentLang: z.string().nullable(),
  viewport: ViewportSchema,
  layout: LayoutMetricsSchema,
  capturedAt: IsoTimestampSchema,
  /** How this state was reached, when it took interaction rather than a URL. */
  interactionPath: z.array(z.string()).default([]),
  html: z.string(),
  htmlTruncated: z.boolean(),
  elements: z.array(ElementRecordSchema),
  /** Playwright's ARIA snapshot — the tree as assistive technology sees it. */
  ariaSnapshot: z.string(),
  axTreeSource: z.enum(['cdp', 'unavailable']),
  artifacts: CaptureArtifactsSchema,
  consoleErrors: z.array(ConsoleErrorSchema),
  media: MediaInventorySchema,
  degradations: z.array(CaptureDegradationSchema),
});
export type StateCapture = z.infer<typeof StateCaptureSchema>;
