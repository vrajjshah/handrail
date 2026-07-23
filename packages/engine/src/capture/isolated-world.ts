import type { CDPSession, Page } from 'playwright';

/**
 * A CDP isolated world: a separate JavaScript realm that shares the page's DOM
 * but has its own globals.
 *
 * Reading a page without changing it is a correctness requirement, not
 * fastidiousness — a scanner that injects globals or marker attributes is
 * measuring a page that no real user ever loads. The isolated world gives full
 * DOM access with nothing written back into the page's own realm.
 *
 * It also solves a mundane problem cleanly. Bundlers wrap named functions in a
 * `__name` helper that does not exist in a fresh realm, which is why browser-side
 * code in Playwright projects so often degrades into untyped source strings. A
 * one-line shim *inside the isolated world* keeps the collector a normal, typed
 * TypeScript function — and the shim never reaches the page.
 */
export class IsolatedWorld {
  private readonly cdp: CDPSession;
  private readonly contextId: number;

  private constructor(cdp: CDPSession, contextId: number) {
    this.cdp = cdp;
    this.contextId = contextId;
  }

  static async create(page: Page, worldName = 'handrail-capture'): Promise<IsolatedWorld> {
    const cdp = await page.context().newCDPSession(page);
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const world = (await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName,
      grantUniveralAccess: false,
    }));

    const isolated = new IsolatedWorld(cdp, world.executionContextId);
    await isolated.raw('globalThis.__name = globalThis.__name || ((f) => f); true');
    return isolated;
  }

  /** The underlying session, for the AX and DOM domains. */
  get session(): CDPSession {
    return this.cdp;
  }

  /**
   * Evaluates a function in the isolated world with one JSON-serialisable
   * argument, and returns its JSON-serialisable result.
   *
   * The result crosses the boundary as a JSON string rather than through CDP's
   * deep object serialiser, which is markedly faster for the element index —
   * thousands of records with twenty style properties each.
   */
  async evaluate<Arg, Result>(fn: (arg: Arg) => Result, arg: Arg): Promise<Result> {
    const expression = `JSON.stringify((${fn.toString()})(${JSON.stringify(arg)}))`;
    const json = await this.raw(expression);
    if (typeof json !== 'string') {
      throw new Error('isolated world returned a non-serialisable result');
    }
    return JSON.parse(json) as Result;
  }

  private async raw(expression: string): Promise<unknown> {
    const response = (await this.cdp.send('Runtime.evaluate', {
      expression,
      contextId: this.contextId,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result: { value?: unknown };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };

    if (response.exceptionDetails !== undefined) {
      const { text, exception } = response.exceptionDetails;
      throw new Error(`isolated world evaluation failed: ${exception?.description ?? text}`);
    }
    return response.result.value;
  }

  async dispose(): Promise<void> {
    await this.cdp.detach().catch(() => {
      // The session goes away with the page; a failure here is not worth raising.
    });
  }
}
