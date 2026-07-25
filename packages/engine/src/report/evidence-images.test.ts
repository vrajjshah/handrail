import {
  FindingSchema,
  ScanRecordSchema,
  findingId,
  pageStateId,
  scanId,
  type ArtifactId,
  type Report,
} from '@handrail/schemas';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { MemoryArtifactStore } from '../capture/artifacts.js';
import { buildReport } from './build-report.js';
import { buildEvidenceImages } from './evidence-images.js';

const store = new MemoryArtifactStore();
let shotId: ArtifactId;

/**
 * A 2880×1600 screenshot of a 1440-wide viewport — a 2× device scale factor, the
 * ordinary case on a retina capture and the one where a naive overlay lands at
 * half the right coordinates.
 */
beforeAll(async () => {
  const png = await sharp({
    create: { width: 2880, height: 1600, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  shotId = await store.put(png, 'shot');
});

function reportWith(bbox: { x: number; y: number; width: number; height: number }): Report {
  return buildReport({
    scan: ScanRecordSchema.parse({
      id: scanId('scan_1'),
      target: {
        kind: 'url',
        url: 'https://example.com/',
        viewports: [{ label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2 }],
      },
      options: { mode: 'deterministic' },
      status: 'completed',
      createdAt: '2026-07-25T10:00:00.000Z',
    }),
    findings: [
      FindingSchema.parse({
        id: findingId('find_1'),
        checkId: 'ptr.target-size',
        source: 'heuristic:ptr.target-size',
        sc: ['2.5.8'],
        scPrimary: '2.5.8',
        tier: 'violation',
        severity: 'serious',
        confidence: 1,
        evidence: [{ kind: 'screenshot', artifactId: shotId, bbox }],
        element: { selector: 'button.tiny', bbox },
        page: { url: 'https://example.com/', pageStateId: pageStateId('st_1'), viewport: 'desktop' },
        verification: { method: 'none', status: 'unverified' },
        description: 'Target is smaller than 24 by 24 CSS pixels.',
      }),
    ],
    toolVersion: '0.1.0',
  });
}

describe('evidence images', () => {
  it('crops to the element and places the overlay inside the crop', async () => {
    // 200 CSS px from the left at 2× is pixel 400 in the screenshot.
    const images = await buildEvidenceImages(reportWith({ x: 200, y: 300, width: 100, height: 40 }), {
      store,
      padding: 25,
      maxWidth: 640,
    });

    const image = images.get('find_1:0');
    expect(image).toBeDefined();
    expect(image?.dataUri.startsWith('data:image/png;base64,')).toBe(true);

    // Crop is (100 + 2 * 25) CSS px wide at 2× = 300 image px, so the 200px-wide
    // element occupies two thirds of it, starting one sixth in.
    expect(image?.highlight?.left).toBeCloseTo(100 / 6, 1);
    expect(image?.highlight?.width).toBeCloseTo(200 / 3, 1);
  });

  it('never lets an overlay escape the image it is drawn on', async () => {
    // An element flush against the left edge: the padding has nowhere to go.
    const images = await buildEvidenceImages(reportWith({ x: 0, y: 0, width: 40, height: 40 }), {
      store,
      padding: 40,
    });
    const highlight = images.get('find_1:0')?.highlight;
    expect(highlight?.left).toBe(0);
    expect((highlight?.left ?? 0) + (highlight?.width ?? 0)).toBeLessThanOrEqual(100);
  });

  it('shrinks the crop to the embed width so the file stays mailable', async () => {
    const images = await buildEvidenceImages(
      reportWith({ x: 0, y: 0, width: 1400, height: 800 }),
      { store, maxWidth: 320 },
    );
    expect(images.get('find_1:0')?.width).toBe(320);
  });

  it('skips an artifact the store cannot produce rather than failing the report', async () => {
    const report = reportWith({ x: 10, y: 10, width: 10, height: 10 });
    const empty = new MemoryArtifactStore();
    await expect(buildEvidenceImages(report, { store: empty })).resolves.toEqual(new Map());
  });

  it('honours the image cap', async () => {
    const report = reportWith({ x: 10, y: 10, width: 10, height: 10 });
    await expect(buildEvidenceImages(report, { store, maxImages: 0 })).resolves.toEqual(new Map());
  });
});
