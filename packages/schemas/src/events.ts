import { z } from 'zod';

import { FindingSchema } from './finding.js';
import { ModelInvocationSchema } from './model.js';
import {
  ArtifactIdSchema,
  BoundingBoxSchema,
  IsoTimestampSchema,
  PageStateIdSchema,
  ScanIdSchema,
  ViewportLabelSchema,
} from './primitives.js';
import { DegradationSchema, ScanPhaseSchema } from './scan.js';

/**
 * The event stream is the same data in every surface: the CLI renders it as
 * progress lines, the server replays it over SSE with `Last-Event-ID`, and the
 * golden-scan test diffs a normalised version of it.
 *
 * `seq` is monotonic per scan and doubles as the SSE event id, which is what
 * makes replay-after-reconnect exact rather than approximate.
 */
const EventBase = {
  scanId: ScanIdSchema,
  seq: z.int().nonnegative(),
  ts: IsoTimestampSchema,
};

export const ScanEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...EventBase,
    type: z.literal('phase.started'),
    phase: ScanPhaseSchema,
  }),
  z.object({
    ...EventBase,
    type: z.literal('phase.completed'),
    phase: ScanPhaseSchema,
    durationMs: z.int().nonnegative(),
  }),
  z.object({
    ...EventBase,
    type: z.literal('phase.failed'),
    phase: ScanPhaseSchema,
    code: z.string().min(1),
    message: z.string().min(1).max(4000),
  }),
  z.object({
    ...EventBase,
    type: z.literal('finding.detected'),
    finding: FindingSchema,
  }),
  z.object({
    ...EventBase,
    type: z.literal('screenshot.captured'),
    artifactId: ArtifactIdSchema,
    pageStateId: PageStateIdSchema,
    url: z.url(),
    viewport: ViewportLabelSchema,
    bbox: BoundingBoxSchema.optional(),
  }),
  z.object({
    ...EventBase,
    type: z.literal('model.invoked'),
    invocation: ModelInvocationSchema,
  }),
  z.object({
    ...EventBase,
    type: z.literal('scan.degraded'),
    degradation: DegradationSchema,
  }),
  z.object({
    ...EventBase,
    type: z.literal('scan.completed'),
    findingsTotal: z.int().nonnegative(),
    costUsd: z.number().nonnegative(),
    durationMs: z.int().nonnegative(),
  }),
  z.object({
    ...EventBase,
    type: z.literal('scan.failed'),
    code: z.string().min(1),
    message: z.string().min(1).max(4000),
  }),
  z.object({
    ...EventBase,
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1).max(4000),
    phase: ScanPhaseSchema.optional(),
  }),
]);
export type ScanEvent = z.infer<typeof ScanEventSchema>;
export type ScanEventType = ScanEvent['type'];

/** True for the two events after which no further events will arrive for a scan. */
export function isTerminalEvent(event: ScanEvent): boolean {
  return event.type === 'scan.completed' || event.type === 'scan.failed';
}
