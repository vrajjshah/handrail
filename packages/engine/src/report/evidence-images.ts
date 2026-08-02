import type { ArtifactId, BoundingBox, Report, Viewport } from '@handrail/schemas';
import sharp from 'sharp';

import type { ArtifactStore } from '../capture/artifacts.js';
import type { EvidenceImage } from './html.js';

export interface EvidenceImageOptions {
  /**
   * Read-only on purpose. Rendering a report never writes an artifact, and the
   * hosted server hands this a reader that can only read — narrowing the
   * parameter is what lets it, rather than a cast at the call site.
   */
  store: Pick<ArtifactStore, 'get'>;
  /** Longest edge of an embedded crop, in pixels. */
  maxWidth?: number;
  /** Context to keep around the element, in CSS pixels. */
  padding?: number;
  /**
   * Ceiling on how many images get inlined. A self-contained report is only
   * useful if it can be opened and emailed; a hundred full-page PNGs in base64
   * is a file nobody's mail client will accept.
   */
  maxImages?: number;
}

const DEFAULTS = { maxWidth: 640, padding: 24, maxImages: 60 } as const;

/**
 * Crop each screenshot to the element it is evidence for, and compute where the
 * bounding box lands inside the crop.
 *
 * The percentages are computed **here**, at render time, from the real pixel
 * dimensions of the image that is actually embedded — not from page coordinates
 * a browser might later re-interpret. That is the difference between an overlay
 * that marks the right element and one that is confidently three rows off, which
 * in an evidence-first report is worse than no overlay at all.
 *
 * The scale factor is derived (`imageWidth / viewportWidth`) rather than taken
 * from `deviceScaleFactor`, because the screenshot is the ground truth about its
 * own resolution and a viewport config can drift from what was captured.
 */
export async function buildEvidenceImages(
  report: Report,
  options: EvidenceImageOptions,
): Promise<Map<string, EvidenceImage>> {
  const maxWidth = options.maxWidth ?? DEFAULTS.maxWidth;
  const padding = options.padding ?? DEFAULTS.padding;
  const maxImages = options.maxImages ?? DEFAULTS.maxImages;

  const images = new Map<string, EvidenceImage>();
  const sources = new Map<string, { png: Buffer; width: number; height: number } | null>();
  const viewports = new Map<string, Viewport>(
    report.scan.target.viewports.map((viewport) => [viewport.label, viewport]),
  );

  async function sourceFor(id: ArtifactId) {
    const key = String(id);
    const cached = sources.get(key);
    if (cached !== undefined) return cached;
    try {
      const png = await options.store.get(id);
      const { width = 0, height = 0 } = await sharp(png).metadata();
      const source = width > 0 && height > 0 ? { png, width, height } : null;
      sources.set(key, source);
      return source;
    } catch {
      // A missing artifact is a gap in the report, not a reason to fail the run.
      sources.set(key, null);
      return null;
    }
  }

  for (const finding of report.findings) {
    for (const [index, evidence] of finding.evidence.entries()) {
      if (evidence.kind !== 'screenshot') continue;
      if (images.size >= maxImages) return images;

      const source = await sourceFor(evidence.artifactId);
      if (source === null) continue;

      const viewport = viewports.get(finding.page.viewport);
      const scale = viewport === undefined ? 1 : source.width / viewport.width;
      const bbox = evidence.bbox ?? finding.element?.bbox;

      const image =
        bbox === undefined
          ? await wholeImage(source.png, maxWidth)
          : await croppedImage(source, bbox, scale, padding, maxWidth);
      if (image === undefined) continue;

      images.set(`${String(finding.id)}:${String(index)}`, image);
    }
  }

  return images;
}

async function encode(png: Buffer): Promise<{ dataUri: string; width: number; height: number }> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return { dataUri: `data:image/png;base64,${png.toString('base64')}`, width, height };
}

async function wholeImage(png: Buffer, maxWidth: number): Promise<EvidenceImage | undefined> {
  const resized = await sharp(png).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
  return encode(resized);
}

async function croppedImage(
  source: { png: Buffer; width: number; height: number },
  bbox: BoundingBox,
  scale: number,
  padding: number,
  maxWidth: number,
): Promise<EvidenceImage | undefined> {
  const box = {
    x: bbox.x * scale,
    y: bbox.y * scale,
    width: Math.max(1, bbox.width * scale),
    height: Math.max(1, bbox.height * scale),
  };
  const pad = padding * scale;

  const left = clamp(Math.round(box.x - pad), 0, Math.max(0, source.width - 1));
  const top = clamp(Math.round(box.y - pad), 0, Math.max(0, source.height - 1));
  const width = clamp(Math.round(box.width + pad * 2), 1, source.width - left);
  const height = clamp(Math.round(box.height + pad * 2), 1, source.height - top);

  // An element scrolled out of the captured region has nothing to crop to.
  if (box.x >= source.width || box.y >= source.height) return undefined;

  const cropped = await sharp(source.png)
    .extract({ left, top, width, height })
    .resize({ width: maxWidth, withoutEnlargement: true })
    .png()
    .toBuffer();

  const encoded = await encode(cropped);
  return {
    ...encoded,
    highlight: {
      left: clampPercent(((box.x - left) / width) * 100),
      top: clampPercent(((box.y - top) / height) * 100),
      width: clampPercent((box.width / width) * 100),
      height: clampPercent((box.height / height) * 100),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPercent(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 100);
}
