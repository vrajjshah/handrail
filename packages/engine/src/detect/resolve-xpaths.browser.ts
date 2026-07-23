/**
 * Resolves axe target selectors to xpaths, in a CDP isolated world.
 *
 * axe reports each finding against a CSS selector; the element index is keyed by
 * xpath. Resolving here — rather than in the main world alongside axe — keeps
 * this a normal typed function: the isolated world's `__name` shim means named
 * inner helpers are safe, which they are not under `page.evaluate`.
 *
 * Self-contained: `fn.toString()` serialises only this body, so the xpath helper
 * lives inside it.
 */
export function resolveTargetXpaths(targets: string[]): (string | null)[] {
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

  return targets.map((selector) => {
    try {
      const el = document.querySelector(selector);
      return el === null ? null : xpathOf(el);
    } catch {
      return null;
    }
  });
}
