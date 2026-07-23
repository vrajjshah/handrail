import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { artifactId, type ArtifactId, type BoundingBox } from '@handrail/schemas';
import sharp from 'sharp';

/**
 * Where screenshots and crops live.
 *
 * Behind an interface because the hosted service will put these in R2 with a
 * 14-day retention while the CLI writes them next to the report — and because
 * screenshots can contain personal data, so the storage decision is a privacy
 * decision, not an implementation detail.
 */
export interface ArtifactStore {
  put(bytes: Buffer, kind: string): Promise<ArtifactId>;
  get(id: ArtifactId): Promise<Buffer>;
}

export class FileSystemArtifactStore implements ArtifactStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async put(bytes: Buffer, kind: string): Promise<ArtifactId> {
    await mkdir(this.directory, { recursive: true });
    // Content-addressed: identical screenshots across a scan are stored once,
    // and a re-capture of an unchanged page produces the same id.
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const id = artifactId(`${kind}_${digest}`);
    await writeFile(join(this.directory, `${id}.png`), bytes);
    return id;
  }

  async get(id: ArtifactId): Promise<Buffer> {
    return readFile(join(this.directory, `${id}.png`));
  }
}

/** An in-memory store, for tests and for scans that never persist anything. */
export class MemoryArtifactStore implements ArtifactStore {
  private readonly items = new Map<string, Buffer>();

  put(bytes: Buffer, kind: string): Promise<ArtifactId> {
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const id = artifactId(`${kind}_${digest}`);
    this.items.set(id, bytes);
    return Promise.resolve(id);
  }

  get(id: ArtifactId): Promise<Buffer> {
    const bytes = this.items.get(id);
    if (bytes === undefined) return Promise.reject(new Error(`no such artifact: ${id}`));
    return Promise.resolve(bytes);
  }

  get size(): number {
    return this.items.size;
  }
}

export interface CropOptions {
  /** Pixels of context to keep around the element. */
  padding?: number;
  /** Longest edge of the output, in pixels. */
  maxEdge?: number;
}

/**
 * Cuts an element's region out of a full-page screenshot.
 *
 * Lazy on purpose: a scan captures one full-page PNG per state and crops from it
 * only for the findings that end up needing visual evidence. Cropping eagerly
 * would mean thousands of images per page, nearly all discarded.
 *
 * The `maxEdge` default of 300px is a cost decision as much as a rendering one —
 * a crop that size costs roughly 120 vision tokens, against ~4,800 for a
 * full-resolution screenshot on a high-resolution model.
 */
export async function cropToElement(
  fullPagePng: Buffer,
  bbox: BoundingBox,
  options: CropOptions = {},
): Promise<Buffer> {
  const padding = options.padding ?? 8;
  const maxEdge = options.maxEdge ?? 300;

  const image = sharp(fullPagePng);
  const { width = 0, height = 0 } = await image.metadata();

  const left = Math.max(0, Math.round(bbox.x - padding));
  const top = Math.max(0, Math.round(bbox.y - padding));
  const cropWidth = Math.max(1, Math.min(Math.round(bbox.width + padding * 2), width - left));
  const cropHeight = Math.max(1, Math.min(Math.round(bbox.height + padding * 2), height - top));

  if (left >= width || top >= height) {
    throw new Error(
      `bbox at (${String(bbox.x)}, ${String(bbox.y)}) falls outside the ${String(width)}x${String(height)} screenshot`,
    );
  }

  return sharp(fullPagePng)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

/**
 * Shrinks a screenshot to a width the vision models are billed sensibly for.
 *
 * 1024px wide is roughly 2.7K image tokens. Sending the raw full-page capture of
 * a long page instead can cost an order of magnitude more for no extra judgment
 * quality, so normalisation here is load-bearing for the per-scan budget.
 */
export async function normaliseForVision(png: Buffer, maxWidth = 1024): Promise<Buffer> {
  return sharp(png).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
}
