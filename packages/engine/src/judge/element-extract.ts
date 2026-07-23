import type { ElementRecord, StateCapture } from '../capture/types.js';
import { sanitizeForPrompt, sanitizeOptional } from './sanitize.js';

/**
 * One element as the judge sees it.
 *
 * Deliberately tiny. A full {@link ElementRecord} carries a 20-property computed
 * style, a bbox, an xpath and a selector — none of which a *text* judge can use,
 * and all of which would be paid for at $1/MTok on every page of every scan. What
 * survives is what the nine claim families actually read.
 */
export interface ExtractElement {
  /** The capture's `elemId`. This is what a candidate must name, and what grounding checks. */
  id: string;
  tag: string;
  role: string | null;
  /** Accessible name as Chromium computed it — what a screen reader announces. */
  name: string | null;
  text: string | null;
  attrs: Record<string, string>;
}

export interface ElementExtract {
  page: {
    url: string;
    title: string;
    /** The document language, or null when the page declares none. */
    lang: string | null;
    viewport: string;
  };
  elements: ExtractElement[];
  /** How many elements in the index were relevant to the text judge at all. */
  relevantElements: number;
  /** Relevant elements dropped to stay inside the token budget. */
  omittedElements: number;
  estimatedTokens: number;
  truncated: boolean;
}

/**
 * Attributes the nine families read, in the order they are rendered.
 *
 * A whitelist rather than "everything the capture kept": `data-*`, `style`,
 * framework attributes and the rest are noise the judge would be charged for,
 * and every extra attribute is another string of page-controlled text in the
 * prompt.
 */
const RENDERED_ATTRIBUTES = [
  'href',
  'alt',
  'title',
  'type',
  'placeholder',
  'lang',
  'for',
  'id',
  'required',
  'disabled',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-errormessage',
  'aria-invalid',
  'aria-required',
  'aria-hidden',
] as const;

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
const STATUS_ROLES = new Set(['alert', 'alertdialog', 'status', 'log']);

/**
 * Relevance tiers, used only when the budget bites.
 *
 * Structure first: the heading outline and the page element are *sequence*
 * claims, and dropping one heading from the middle of a page would invent a
 * level skip that is not there — a truncation that manufactures a false
 * positive is far worse than one that misses a real issue.
 */
const PRIORITY = {
  structure: 0,
  control: 1,
  link: 2,
  media: 3,
  other: 4,
} as const;
type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];
const LOWEST_PRIORITY = PRIORITY.other;

function priorityOf(el: ElementRecord): Priority | undefined {
  if (el.tag === 'html') return PRIORITY.structure;
  if (HEADING_TAGS.has(el.tag) || el.role === 'heading') return PRIORITY.structure;

  // Everything below is only interesting if a user can perceive it.
  if (!el.visible) return undefined;

  if (CONTROL_TAGS.has(el.tag) || el.tag === 'label') return PRIORITY.control;
  if (el.role !== null && CONTROL_ROLES.has(el.role)) return PRIORITY.control;
  if (el.role !== null && STATUS_ROLES.has(el.role)) return PRIORITY.control;
  if (el.attributes['aria-invalid'] !== undefined) return PRIORITY.control;
  if (el.attributes['aria-errormessage'] !== undefined) return PRIORITY.control;

  if (el.tag === 'a' && el.attributes.href !== undefined) return PRIORITY.link;
  if (el.tag === 'button' || el.role === 'link' || el.role === 'button') return PRIORITY.link;

  if (el.tag === 'img' || el.role === 'img') return PRIORITY.media;
  // `lang` on a subtree is the only signal 3.1.2 has to work from.
  if (el.attributes.lang !== undefined) return PRIORITY.other;

  return undefined;
}

const MAX_TEXT = 200;
const MAX_NAME = 200;
const MAX_ATTRIBUTE = 160;

function projectElement(el: ElementRecord): ExtractElement {
  const attrs: Record<string, string> = {};
  for (const key of RENDERED_ATTRIBUTES) {
    const raw = el.attributes[key];
    if (raw === undefined) continue;
    // An empty alt is *meaningful* — it is how a decorative image is declared —
    // so it is rendered as the empty string rather than dropped. Getting this
    // wrong is the single commonest AI false positive in this domain.
    attrs[key] = sanitizeForPrompt(raw, MAX_ATTRIBUTE);
  }

  return {
    id: el.elemId,
    tag: el.tag,
    role: el.role,
    name: sanitizeOptional(el.accessibleName, MAX_NAME),
    text: sanitizeOptional(el.text, MAX_TEXT),
    attrs,
  };
}

/**
 * Token estimate for a rendered payload.
 *
 * Chars-per-token varies by tokenizer, and Sonnet 5's yields roughly 30% more
 * tokens for the same text than 4.x did (ADR-0004). The judge runs on Haiku, but
 * budgeting against the *denser* tokenizer means a model swap cannot silently
 * blow the budget — an over-estimate costs us a few dropped elements, an
 * under-estimate costs a `context-length` failure mid-scan.
 */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ElementExtractOptions {
  /**
   * Token ceiling for the rendered element list. The plan's per-state text budget
   * is 8K input; the system prefix and the framing take the rest.
   */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 6000;

/** The JSON line one element contributes to the payload. Kept identical to what {@link renderExtract} emits. */
function lineFor(element: ExtractElement): string {
  return JSON.stringify(element);
}

/**
 * Project a captured state into the compact extract the batched text judge reads.
 *
 * Two properties matter more than compactness:
 *
 * - **Every string here has been through {@link sanitizeForPrompt}.** The page is
 *   hostile until proven otherwise.
 * - **Every element carries its `elemId`.** That id is the contract with the
 *   verdict pipeline: a candidate naming an id that is not in this list has
 *   hallucinated, and grounding rejects it without a second opinion.
 */
export function buildElementExtract(
  capture: StateCapture,
  options: ElementExtractOptions = {},
): ElementExtract {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const relevant: { el: ElementRecord; priority: Priority }[] = [];
  for (const el of capture.elements) {
    const priority = priorityOf(el);
    if (priority !== undefined) relevant.push({ el, priority });
  }

  const kept: ElementRecord[] = [];
  let budgetTokens = 0;
  let truncated = false;

  // Admit whole priority tiers in order, so a budget squeeze degrades along a
  // documented axis instead of wherever the page happened to put its markup.
  for (let tier = 0; tier <= LOWEST_PRIORITY; tier += 1) {
    for (const entry of relevant) {
      if (entry.priority !== tier) continue;
      const cost = estimateTokens(lineFor(projectElement(entry.el)));
      if (budgetTokens + cost > maxTokens) {
        truncated = true;
        continue;
      }
      budgetTokens += cost;
      kept.push(entry.el);
    }
  }

  // Document order is load-bearing: `heading-outline` reads the sequence.
  kept.sort((a, b) => a.ordinal - b.ordinal);

  return {
    page: {
      url: capture.url,
      title: sanitizeForPrompt(capture.title, MAX_TEXT),
      lang: capture.documentLang === null ? null : sanitizeForPrompt(capture.documentLang, 32),
      viewport: capture.viewport.label,
    },
    elements: kept.map(projectElement),
    relevantElements: relevant.length,
    omittedElements: relevant.length - kept.length,
    estimatedTokens: budgetTokens,
    truncated,
  };
}

/** The payload exactly as it reaches the model: one JSON object per line. */
export function renderExtract(extract: ElementExtract): string {
  const header = JSON.stringify({ page: extract.page });
  return [header, ...extract.elements.map(lineFor)].join('\n');
}
