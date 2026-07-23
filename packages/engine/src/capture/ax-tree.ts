import type { CDPSession } from 'playwright';

/**
 * Role and accessible name, keyed by xpath.
 *
 * These come from **Chromium's own accessibility tree**, not from a
 * reimplementation of the accessible-name computation. That algorithm is long,
 * full of edge cases, and the single most load-bearing input to half the checks —
 * "does this control have a name" is the question behind 1.1.1, 2.4.4, 2.5.3 and
 * 4.1.2. Reimplementing it would mean our findings disagree with what a screen
 * reader actually announces, which is the one thing a tool like this cannot afford.
 */
export type AxIndex = ReadonlyMap<string, { role: string; name: string }>;

interface DomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  children?: DomNode[];
}

interface AxNode {
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
}

/**
 * Reconstructs an xpath for every element in the DOM tree CDP returns.
 *
 * Doing it here rather than in the page is what lets the accessibility tree be
 * joined to the element index without touching the document: CDP hands back the
 * structure, and the same xpath algorithm the in-page collector uses is replayed
 * over it in Node.
 */
function xpathsByBackendId(root: DomNode): Map<number, string> {
  const index = new Map<number, string>();

  const walk = (node: DomNode, parentPath: string): void => {
    const counts = new Map<string, number>();
    for (const child of node.children ?? []) {
      if (child.nodeType !== 1) continue;
      const tag = child.nodeName.toLowerCase();
      const nth = (counts.get(tag) ?? 0) + 1;
      counts.set(tag, nth);
      const path = `${parentPath}/${tag}[${String(nth)}]`;
      index.set(child.backendNodeId, path);
      walk(child, path);
    }
  };

  walk(root, '');
  return index;
}

/**
 * Builds the xpath → {role, name} index from CDP.
 *
 * Two calls total, whatever the page size. The obvious alternative — resolving
 * each accessibility node to a DOM node individually — is a round trip per node
 * and takes seconds on a real page.
 */
export async function readAxTree(cdp: CDPSession): Promise<AxIndex> {
  await cdp.send('Accessibility.enable');
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: DomNode };
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] };

  const xpaths = xpathsByBackendId(root);
  const index = new Map<string, { role: string; name: string }>();

  for (const node of nodes) {
    if (node.backendDOMNodeId === undefined) continue;
    const xpath = xpaths.get(node.backendDOMNodeId);
    if (xpath === undefined) continue;

    const role = typeof node.role?.value === 'string' ? node.role.value : '';
    const name = typeof node.name?.value === 'string' ? node.name.value : '';

    // An ignored node still occupies the tree; keep the first non-ignored entry
    // for an xpath so a presentational wrapper cannot mask its own element.
    if (index.has(xpath) && node.ignored === true) continue;
    index.set(xpath, { role, name });
  }

  return index;
}
