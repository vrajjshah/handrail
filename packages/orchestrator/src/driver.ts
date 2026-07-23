import type {
  ArtifactStore,
  AxeDetectionResult,
  HeuristicResult,
  StateCapture,
} from '@handrail/engine';
import type { Viewport } from '@handrail/schemas';

export interface CaptureRequest {
  url: string;
  viewport: Viewport;
  /** Where screenshots go. Omit to skip them — a deterministic $0 scan may. */
  artifacts?: ArtifactStore | undefined;
}

/**
 * Everything the graph needs a browser for.
 *
 * Dependency inversion, and it earns its keep twice. First, it keeps Playwright
 * out of this package's dependency list — the engine owns the browser, and the
 * graph only ever asks it for a captured state. Second, and the reason the
 * acceptance suite can run on three operating systems without a Chromium
 * download: a driver that replays a committed capture is a drop-in for one that
 * drives a real page, so the graph itself is testable browser-free.
 *
 * The page behind a capture stays open until {@link release}. That is not an
 * implementation detail the graph could ignore: axe runs *in* the page and the
 * keyboard walk presses real Tab keys, so both detection layers must reach the
 * same live page the capture was taken from, and they run in a later node.
 */
export interface ScanDriver {
  /** Load `url` at `viewport` and capture it. Leaves the page open for detection. */
  capture(request: CaptureRequest): Promise<StateCapture>;
  /** Run axe against the page this capture came from. */
  axe(capture: StateCapture): Promise<AxeDetectionResult>;
  /** Run the heuristic layer, including the real keyboard traversal. */
  heuristics(capture: StateCapture): Promise<HeuristicResult>;
  /** Close the page behind a capture. Called once detection is done with it. */
  release(capture: StateCapture): Promise<void>;
  /** Release everything still open. Called at the end of a run, failure included. */
  dispose(): Promise<void>;
}
