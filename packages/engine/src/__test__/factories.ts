import { elementId, pageStateId, scanId, type ModelRole } from '@handrail/schemas';
import {
  CostLedger,
  createDeterministicClient,
  type DeterministicResponder,
  type ModelClient,
} from '@handrail/model';

import type { ElementRecord, StateCapture } from '../capture/types.js';

const BLANK_STYLE: ElementRecord['style'] = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  fontSize: '16px',
  fontWeight: '400',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  overflowX: 'visible',
  overflowY: 'visible',
  whiteSpace: 'normal',
  cursor: 'auto',
  outlineStyle: 'none',
  outlineWidth: '0px',
  outlineColor: 'rgb(0, 0, 0)',
  outlineOffset: '0px',
  boxShadow: 'none',
  borderColor: 'rgb(0, 0, 0)',
  borderWidth: '0px',
};

let counter = 0;

/** An indexed element with sane defaults. Pass only what the assertion is about. */
export function element(overrides: Partial<ElementRecord> = {}): ElementRecord {
  counter += 1;
  const ordinal = overrides.ordinal ?? counter;
  const xpath = overrides.xpath ?? `/html[1]/body[1]/div[${String(ordinal)}]`;
  return {
    elemId: elementId(`e${String(ordinal)}`),
    ordinal,
    xpath,
    selector: xpath,
    tag: 'div',
    role: null,
    accessibleName: null,
    bbox: { x: 0, y: 0, width: 100, height: 40 },
    visible: true,
    focusable: false,
    tabIndex: -1,
    text: null,
    attributes: {},
    style: BLANK_STYLE,
    ...overrides,
  };
}

export function capture(overrides: Partial<StateCapture> = {}): StateCapture {
  return {
    pageStateId: pageStateId('st_test'),
    url: 'https://example.com/',
    title: 'Test page',
    documentLang: 'en',
    viewport: { label: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
    layout: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 2000, clientHeight: 900 },
    capturedAt: '2026-07-23T10:00:00.000Z',
    interactionPath: [],
    html: '<html><body></body></html>',
    htmlTruncated: false,
    elements: [],
    ariaSnapshot: '',
    axTreeSource: 'cdp',
    artifacts: { fullPage: null, viewport: null },
    consoleErrors: [],
    media: {
      images: 0,
      imagesWithoutAlt: 0,
      decorativeImages: 0,
      svg: 0,
      canvas: 0,
      video: 0,
      audio: 0,
      autoplayingMedia: 0,
      mediaWithCaptionTrack: 0,
      iframes: 0,
      thirdPartyMediaEmbeds: 0,
    },
    degradations: [],
    ...overrides,
  };
}

/** A ledger with a frozen clock, so latency and timestamps are assertable. */
export function testLedger(): CostLedger {
  let tick = 0;
  return new CostLedger({
    scanId: scanId('scan_test'),
    now: () => new Date(Date.UTC(2026, 6, 23, 12, 0, 0) + tick++ * 1000),
    newId: () => `inv_${String(tick)}`,
  });
}

/** A scripted answer for one role, chosen from the rendered user turn. */
export type RoleScript = (userText: string) => unknown;

/** Flattens a request's messages back to text, which is all the scripts need to key on. */
function userTextOf(messages: readonly { content: unknown }[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    )
    .join('\n');
}

/**
 * A `local-deterministic` client scripted by role.
 *
 * This is the $0 offline backbone the whole judgment suite rests on: no network,
 * no key, and the same answer every run — which is what lets the verdict
 * pipeline be tested as a *pipeline* rather than as a wrapper around a model's
 * mood on the day. Scripts see the rendered user turn, so a verifier script can
 * answer differently per claim exactly as a real verifier would.
 */
export function scriptedClient(byRole: Partial<Record<ModelRole, RoleScript>>): ModelClient {
  const responder: DeterministicResponder = (request) => {
    const script = byRole[request.role];
    if (script === undefined) return undefined;
    return { kind: 'respond', output: script(userTextOf(request.messages)) };
  };
  return createDeterministicClient({ responders: [responder] });
}

/** A script that answers the same thing however it is asked. */
export function always(value: unknown): RoleScript {
  return () => value;
}
