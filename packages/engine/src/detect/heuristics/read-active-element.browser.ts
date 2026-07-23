/**
 * Reads the currently focused element, from a CDP isolated world.
 *
 * `document.activeElement` is a document property, and the isolated world shares
 * the page's document — so it sees the same real focus a keyboard user moved,
 * without the main world's `__name` bundler trap. Self-contained: the xpath
 * helper lives inside the body because `fn.toString()` serialises only this body.
 */

export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  borderWidth: string;
  backgroundColor: string;
}

export interface ActiveElementInfo {
  xpath: string;
  tag: string;
  focusStyle: FocusStyle;
}

export function readActiveElement(): ActiveElementInfo | null {
  const el = document.activeElement;
  // body / html / null mean focus is not on a real control — the end of a tab
  // sequence, or focus that escaped into browser chrome.
  if (el === null || el === document.body || el === document.documentElement) return null;

  const xpathOf = (node: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = node; n !== null; n = n.parentElement) {
      let index = 1;
      for (let prev = n.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.tagName === n.tagName) index += 1;
      }
      parts.unshift(`${n.tagName.toLowerCase()}[${String(index)}]`);
    }
    return `/${parts.join('/')}`;
  };

  const style = getComputedStyle(el);
  return {
    xpath: xpathOf(el),
    tag: el.tagName.toLowerCase(),
    focusStyle: {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      backgroundColor: style.backgroundColor,
    },
  };
}
