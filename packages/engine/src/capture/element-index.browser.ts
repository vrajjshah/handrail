/**
 * The in-page element collector.
 *
 * This function never runs in Node. It is stringified and evaluated inside a CDP
 * **isolated world** — a separate JavaScript realm that shares the page's DOM but
 * not its globals. Two things follow from that, and both matter:
 *
 * 1. **The target page is untouched.** No attributes are added to mark elements,
 *    no globals are defined in the page's realm, no styles are injected. A scan
 *    that perturbed the page would be measuring its own footprint.
 * 2. **Named inner helpers are safe here.** Bundlers wrap named functions in a
 *    `__name` helper that does not exist in a fresh realm; the capture defines a
 *    shim in the isolated world first, so this file can be written normally
 *    instead of as an untyped source string.
 *
 * Keep it self-contained. `fn.toString()` serialises **only this function body**,
 * so a module-level constant referenced from inside it becomes a
 * `ReferenceError` in the page — which is why every table below lives in the
 * body rather than at module scope.
 */

export interface BrowserCollectorOptions {
  /** Stop after this many elements and report a degradation. */
  maxElements: number;
  /** Cap on an element's own-text, in characters. */
  maxTextLength: number;
}

export interface RawElementRecord {
  ordinal: number;
  xpath: string;
  selector: string;
  tag: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
  visible: boolean;
  focusable: boolean;
  tabIndex: number;
  text: string | null;
  attributes: Record<string, string>;
  style: Record<string, string>;
}

export interface RawMediaInventory {
  images: number;
  imagesWithoutAlt: number;
  decorativeImages: number;
  svg: number;
  canvas: number;
  video: number;
  audio: number;
  autoplayingMedia: number;
  mediaWithCaptionTrack: number;
  iframes: number;
  thirdPartyMediaEmbeds: number;
}

export interface RawCollectorResult {
  documentLang: string | null;
  title: string;
  elements: RawElementRecord[];
  media: RawMediaInventory;
  totalElements: number;
  capped: boolean;
}

export function collectElementIndex(options: BrowserCollectorOptions): RawCollectorResult {
  /** Attributes worth carrying. Everything `aria-*` is kept; the rest is this list. */
  const COLLECTED_ATTRIBUTES = [
    'id',
    'role',
    'type',
    'alt',
    'title',
    'href',
    'lang',
    'name',
    'placeholder',
    'autocomplete',
    'tabindex',
    'target',
    'rel',
    'scope',
    'headers',
    'colspan',
    'rowspan',
    'controls',
    'autoplay',
    'muted',
    'loop',
    'disabled',
    'readonly',
    'required',
    'hidden',
    'contenteditable',
    'draggable',
    'accesskey',
    'for',
    'data-testid',
  ] as const;

  const STYLE_PROPERTIES = [
    'color',
    'backgroundColor',
    'backgroundImage',
    'fontSize',
    'fontWeight',
    'display',
    'visibility',
    'opacity',
    'position',
    'overflowX',
    'overflowY',
    'whiteSpace',
    'cursor',
    'outlineStyle',
    'outlineWidth',
    'outlineColor',
    'outlineOffset',
    'boxShadow',
    'borderColor',
    'borderWidth',
  ] as const;

  /** Skipped entirely: their text is code, not content, and they have no layout. */
  const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

  const NATIVELY_FOCUSABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'details']);

  const THIRD_PARTY_MEDIA_HOSTS = [
    'youtube.com',
    'youtube-nocookie.com',
    'youtu.be',
    'vimeo.com',
    'dailymotion.com',
    'wistia.net',
    'brightcove.net',
    'soundcloud.com',
    'spotify.com',
  ];

  const xpathOf = (el: Element): string => {
    const parts: string[] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      let index = 1;
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.tagName === node.tagName) index += 1;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${String(index)}]`);
    }
    return `/${parts.join('/')}`;
  };

  // Ids that look generated (framework hashes, uuids) make brittle selectors, so
  // they are used only as a last resort before falling back to a structural path.
  const isStableId = (id: string): boolean =>
    id.length > 0 &&
    id.length < 60 &&
    !/^[0-9]/.test(id) &&
    !/^(?:react|ember|ng|mui|radix|headlessui)[-:]/i.test(id) &&
    !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(id) &&
    !/:r[0-9a-z]+:/i.test(id);

  const cssEscape = (value: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/[^\w-]/g, (c) => `\\${c}`);

  /**
   * Escapes a value for use inside a double-quoted CSS string.
   *
   * **Backslash first, then quote** — reversing the order double-escapes the
   * backslashes just added and corrupts the selector.
   *
   * This matters more here than it looks. Attribute values come from the page
   * being scanned, which for this tool is untrusted input by definition: we point
   * it at arbitrary URLs. Escaping only the quote leaves a value ending in a
   * backslash able to escape the closing quote and change what the selector
   * matches.
   */
  const cssStringEscape = (value: string): string =>
    value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const resolvesUniquely = (selector: string, el: Element): boolean => {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };

  const selectorOf = (el: Element): string => {
    const id = el.getAttribute('id');
    if (id !== null && isStableId(id)) {
      const candidate = `#${cssEscape(id)}`;
      if (resolvesUniquely(candidate, el)) return candidate;
    }

    const testId = el.getAttribute('data-testid');
    if (testId !== null && testId.length > 0) {
      const candidate = `[data-testid="${cssStringEscape(testId)}"]`;
      if (resolvesUniquely(candidate, el)) return candidate;
    }

    const segments: string[] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'html') {
        segments.unshift(tag);
        break;
      }

      const nodeId = node.getAttribute('id');
      if (nodeId !== null && isStableId(nodeId)) {
        segments.unshift(`#${cssEscape(nodeId)}`);
        break;
      }

      let index = 1;
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.tagName === node.tagName) index += 1;
      }
      segments.unshift(`${tag}:nth-of-type(${String(index)})`);
    }

    const selector = segments.join(' > ');
    return resolvesUniquely(selector, el) ? selector : xpathOf(el);
  };

  const isFocusable = (el: Element, style: CSSStyleDeclaration): boolean => {
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.hasAttribute('inert')) return false;

    const tag = el.tagName.toLowerCase();
    const disabled = el.hasAttribute('disabled');
    if (disabled) return false;

    if (el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'true') {
      return true;
    }
    const tabindexAttr = el.getAttribute('tabindex');
    if (tabindexAttr !== null) return Number.parseInt(tabindexAttr, 10) >= 0;
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'iframe') return true;
    if ((tag === 'audio' || tag === 'video') && el.hasAttribute('controls')) return true;
    return NATIVELY_FOCUSABLE.has(tag);
  };

  const ownTextOf = (el: Element): string | null => {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue ?? '';
    }
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0) return null;
    return trimmed.length > options.maxTextLength
      ? `${trimmed.slice(0, options.maxTextLength)}…`
      : trimmed;
  };

  const attributesOf = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('aria-') || (COLLECTED_ATTRIBUTES as readonly string[]).includes(name)) {
        out[name] = attr.value;
      }
    }
    return out;
  };

  const isThirdPartyMedia = (src: string): boolean => {
    const lowered = src.toLowerCase();
    for (const host of THIRD_PARTY_MEDIA_HOSTS) {
      if (lowered.includes(host)) return true;
    }
    return false;
  };

  const media: RawMediaInventory = {
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
  };

  const all = document.querySelectorAll('*');
  const elements: RawElementRecord[] = [];
  let ordinal = 0;

  for (const el of all) {
    const tag = el.tagName.toLowerCase();

    // Media is tallied across the whole document, even past the element cap, so
    // applicability signals stay right on very large pages.
    if (tag === 'img') {
      media.images += 1;
      const alt = el.getAttribute('alt');
      if (alt === null) media.imagesWithoutAlt += 1;
      else if (alt.trim() === '') media.decorativeImages += 1;
    } else if (tag === 'svg') media.svg += 1;
    else if (tag === 'canvas') media.canvas += 1;
    else if (tag === 'video' || tag === 'audio') {
      if (tag === 'video') media.video += 1;
      else media.audio += 1;
      if (el.hasAttribute('autoplay')) media.autoplayingMedia += 1;
      if (el.querySelector('track[kind="captions"], track[kind="subtitles"]') !== null) {
        media.mediaWithCaptionTrack += 1;
      }
    } else if (tag === 'iframe') {
      media.iframes += 1;
      if (isThirdPartyMedia(el.getAttribute('src') ?? '')) media.thirdPartyMediaEmbeds += 1;
    }

    if (SKIPPED_TAGS.has(tag)) continue;
    if (elements.length >= options.maxElements) continue;

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hasBox = rect.width > 0 || rect.height > 0;

    const styleSubset: Record<string, string> = {};
    for (const property of STYLE_PROPERTIES) styleSubset[property] = style[property];

    elements.push({
      ordinal,
      xpath: xpathOf(el),
      selector: selectorOf(el),
      tag,
      // Document coordinates, not viewport, so a bbox lines up with the
      // full-page screenshot that evidence crops are cut from.
      bbox: hasBox
        ? {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          }
        : null,
      visible:
        hasBox &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity) > 0,
      focusable: isFocusable(el, style),
      tabIndex: (el as HTMLElement).tabIndex,
      text: ownTextOf(el),
      attributes: attributesOf(el),
      style: styleSubset,
    });
    ordinal += 1;
  }

  return {
    documentLang: document.documentElement.getAttribute('lang'),
    title: document.title,
    elements,
    media,
    totalElements: all.length,
    capped: elements.length >= options.maxElements,
  };
}
