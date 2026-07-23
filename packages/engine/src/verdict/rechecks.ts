import type { ElementRecord, StateCapture } from '../capture/types.js';
import type { ClaimFamily } from '../judge/types.js';
import type { GroundedCandidate } from './grounding.js';

/**
 * What a deterministic re-check concluded about an AI claim.
 *
 * - `confirmed` — the machine-decidable part of the claim is true. It does not
 *   make the finding a `violation`: an AI-sourced claim is capped at `likely`
 *   whatever else agrees with it.
 * - `refuted` — the claim's premise is false in a way we can measure. The
 *   candidate is discarded and ledgered.
 * - `inconclusive` — the judgment part is genuinely judgment. The verifier gets
 *   the last word.
 *
 * Only `refuted` is used to reject, and only where refuting is *decidable*.
 * A re-check that guessed "probably not" would quietly become the thing deciding
 * what users see, without any of the evidence a decision needs.
 */
export type RecheckStatus = 'confirmed' | 'refuted' | 'inconclusive';

export interface RecheckResult {
  status: RecheckStatus;
  detail: string;
}

const confirmed = (detail: string): RecheckResult => ({ status: 'confirmed', detail });
const refuted = (detail: string): RecheckResult => ({ status: 'refuted', detail });
const inconclusive = (detail: string): RecheckResult => ({ status: 'inconclusive', detail });

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const CONTROL_TAGS = new Set(['input', 'select', 'textarea']);
const CONTROL_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'spinbutton',
  'checkbox',
  'radio',
  'switch',
  'slider',
]);

/**
 * Link names that carry no purpose out of context.
 *
 * A closed list, matched whole. Substring matching would flag "click here to
 * download the 2026 accessibility statement", which is a perfectly good link
 * name that happens to begin badly.
 */
const UNINFORMATIVE_LINK_NAMES = new Set([
  'click here',
  'here',
  'read more',
  'more',
  'learn more',
  'more info',
  'more information',
  'details',
  'link',
  'this link',
  'this page',
  'go',
  'continue',
  'download',
  'view',
  'see more',
]);

const GENERIC_HEADINGS = new Set([
  'information',
  'details',
  'more',
  'section',
  'untitled',
  'heading',
  'content',
  'misc',
]);

const GENERIC_TITLES = new Set([
  'untitled',
  'untitled document',
  'document',
  'index',
  'home',
  'page',
  'react app',
  'vite + react',
  'new page',
]);

const GENERIC_ALT = new Set([
  'image',
  'img',
  'photo',
  'picture',
  'graphic',
  'icon',
  'logo',
  'screenshot',
  'thumbnail',
  'spacer',
]);

const ALT_PREFIXES = ['image of', 'picture of', 'photo of', 'graphic of', 'icon of'];
const FILENAME_PATTERN = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

function norm(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The name a screen reader announces, falling back to own text when the AX tree had none. */
function announcedName(el: ElementRecord): string {
  return norm(el.accessibleName) || norm(el.text);
}

function isLink(el: ElementRecord): boolean {
  return (el.tag === 'a' && el.attributes.href !== undefined) || el.role === 'link';
}

function isControl(el: ElementRecord): boolean {
  return CONTROL_TAGS.has(el.tag) || (el.role !== null && CONTROL_ROLES.has(el.role));
}

function isHeading(el: ElementRecord): boolean {
  return HEADING_TAGS.has(el.tag) || el.role === 'heading';
}

function isImage(el: ElementRecord): boolean {
  return el.tag === 'img' || el.role === 'img';
}

function headingLevel(el: ElementRecord): number | undefined {
  if (HEADING_TAGS.has(el.tag)) return Number(el.tag.slice(1));
  const ariaLevel = el.attributes['aria-level'];
  if (el.role === 'heading' && ariaLevel !== undefined) {
    const parsed = Number.parseInt(ariaLevel, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Headings in document order, with their levels. The outline a screen reader navigates by. */
export function headingOutline(capture: StateCapture): { el: ElementRecord; level: number }[] {
  return capture.elements
    .filter((el) => isHeading(el) && el.visible)
    .map((el) => ({ el, level: headingLevel(el) }))
    .filter((entry): entry is { el: ElementRecord; level: number } => entry.level !== undefined)
    .sort((a, b) => a.el.ordinal - b.el.ordinal);
}

/** Whether some `<label for="…">` in the index points at this control and says something. */
function hasAssociatedLabel(el: ElementRecord, capture: StateCapture): boolean {
  const id = el.attributes.id;
  if (id === undefined || id === '') return false;
  return capture.elements.some(
    (other) => other.tag === 'label' && other.attributes.for === id && norm(other.text).length > 0,
  );
}

function recheckLinkPurpose(el: ElementRecord): RecheckResult {
  if (!isLink(el)) return refuted(`${el.tag} is not a link, so 2.4.4 cannot apply to it`);

  const name = announcedName(el);
  if (name.length === 0) return confirmed('the link has no accessible name at all');
  if (UNINFORMATIVE_LINK_NAMES.has(name)) {
    return confirmed(`accessible name "${name}" is a known non-descriptive link name`);
  }
  if (name.startsWith('http://') || name.startsWith('https://') || name.startsWith('www.')) {
    return confirmed('the accessible name is a bare URL');
  }
  return inconclusive(`accessible name "${name}" is not on the non-descriptive list`);
}

function recheckLabelQuality(el: ElementRecord, capture: StateCapture): RecheckResult {
  if (!isControl(el)) return refuted(`${el.tag} is not a form control, so 3.3.2 cannot apply to it`);

  const name = norm(el.accessibleName);
  const placeholder = norm(el.attributes.placeholder);
  const ariaLabel = norm(el.attributes['aria-label']);
  const labelledBy = el.attributes['aria-labelledby'];
  const labelled = hasAssociatedLabel(el, capture);

  if (name.length === 0) return confirmed('the control has no accessible name at all');

  // The axe blind spot: Chromium computes the name *from* the placeholder, so
  // the rule engine passes a field whose label vanishes the moment it is typed in.
  if (placeholder.length > 0 && name === placeholder && !labelled && ariaLabel.length === 0) {
    return confirmed('the accessible name comes from the placeholder alone, which disappears on input');
  }

  if (labelled || labelledBy !== undefined || (ariaLabel.length > 0 && ariaLabel !== placeholder)) {
    return refuted('the control has a persistent label independent of its placeholder');
  }

  return inconclusive('the control is named but the source of the name is not decidable here');
}

function recheckHeadingOutline(el: ElementRecord, capture: StateCapture): RecheckResult {
  if (!isHeading(el)) return refuted(`${el.tag} is not a heading`);

  const outline = headingOutline(capture);
  const at = outline.findIndex((entry) => entry.el.elemId === el.elemId);
  if (at === -1) return refuted('the heading is not in the visible heading outline');

  const level = outline[at]!.level;
  const previous = at === 0 ? 0 : outline[at - 1]!.level;

  if (level - previous > 1) {
    const from = at === 0 ? 'the start of the document' : `h${String(previous)}`;
    return confirmed(`the outline jumps from ${from} to h${String(level)}, skipping a level`);
  }
  return refuted(`h${String(level)} follows h${String(previous)}, which skips no level`);
}

function recheckHeadingQuality(el: ElementRecord, capture: StateCapture): RecheckResult {
  if (!isHeading(el)) return refuted(`${el.tag} is not a heading`);

  const text = announcedName(el);
  if (text.length === 0) return confirmed('the heading is empty');
  if (GENERIC_HEADINGS.has(text)) return confirmed(`"${text}" is a generic heading`);

  const duplicates = headingOutline(capture).filter(
    (entry) => announcedName(entry.el) === text,
  ).length;
  if (duplicates > 1) {
    return confirmed(`${String(duplicates)} headings on this page read "${text}"`);
  }
  return inconclusive('whether the heading describes its section is judgment');
}

function recheckPageTitle(el: ElementRecord, capture: StateCapture): RecheckResult {
  if (el.tag !== 'html') return refuted('a page-title claim must be anchored to the html element');

  const title = norm(capture.title);
  if (title.length === 0) return confirmed('the document has no title');
  if (GENERIC_TITLES.has(title)) return confirmed(`"${title}" is a framework default or generic title`);
  return inconclusive('whether the title identifies this page uniquely needs more than one page');
}

function recheckErrorMessage(el: ElementRecord): RecheckResult {
  const invalid = norm(el.attributes['aria-invalid']);
  const isErrorRegion = el.role === 'alert' || el.role === 'status';

  if (invalid !== 'true' && !isErrorRegion) {
    return refuted('the element carries no error state and is not an error region');
  }
  if (
    invalid === 'true' &&
    el.attributes['aria-errormessage'] === undefined &&
    el.attributes['aria-describedby'] === undefined
  ) {
    return confirmed('the control is marked invalid with no programmatically associated description');
  }
  return inconclusive('whether the message identifies the error is judgment');
}

function recheckErrorSuggestion(el: ElementRecord): RecheckResult {
  if (el.role !== 'alert' && el.role !== 'status' && norm(el.attributes['aria-invalid']) !== 'true') {
    return refuted('the element carries no error state and is not an error region');
  }
  return inconclusive('whether the message suggests a correction is judgment');
}

function recheckLangOfParts(el: ElementRecord): RecheckResult {
  const lang = norm(el.attributes.lang);
  if (lang.length > 0) return refuted(`the passage already declares lang="${lang}"`);
  return inconclusive('whether the passage is in another language is judgment');
}

function recheckAltTextTriage(el: ElementRecord): RecheckResult {
  if (!isImage(el)) return refuted(`${el.tag} is not an image`);

  const alt = el.attributes.alt;
  if (alt === undefined) {
    return refuted('the image has no alt attribute at all — the deterministic layer owns that');
  }
  if (alt.trim().length === 0) {
    return refuted('alt="" is how a decorative image is correctly hidden, not a missing alternative');
  }

  const value = norm(alt);
  if (GENERIC_ALT.has(value)) return confirmed(`alt="${alt}" names the medium, not the content`);
  if (FILENAME_PATTERN.test(value.replace(/\s+/g, ''))) {
    return confirmed('the alt text is a filename');
  }
  if (ALT_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return confirmed(`alt text opens with "${value.split(' ').slice(0, 2).join(' ')}", which a screen reader already announces`);
  }
  return inconclusive('whether the alt text is an adequate alternative needs the image itself');
}

const RECHECKS: Record<ClaimFamily, (el: ElementRecord, capture: StateCapture) => RecheckResult> = {
  'link-purpose': (el) => recheckLinkPurpose(el),
  'label-quality': recheckLabelQuality,
  'heading-outline': recheckHeadingOutline,
  'heading-quality': recheckHeadingQuality,
  'page-title': recheckPageTitle,
  'error-message': (el) => recheckErrorMessage(el),
  'error-suggestion': (el) => recheckErrorSuggestion(el),
  'lang-of-parts': (el) => recheckLangOfParts(el),
  'alt-text-triage': (el) => recheckAltTextTriage(el),
};

/**
 * Stage 3a: re-derive, from the captured snapshot alone, whatever part of the
 * claim a machine can decide.
 *
 * This is the cheap half of verification and the half that does not depend on a
 * model's mood. It is also what protects the fixture's traps: a correctly
 * labelled control and a correctly empty `alt` are both *refuted* here, before a
 * verifier is ever asked, because both are decidable and both are correct.
 */
export function recheckCandidate(
  grounded: GroundedCandidate,
  capture: StateCapture,
): RecheckResult {
  return RECHECKS[grounded.spec.family](grounded.element, capture);
}
