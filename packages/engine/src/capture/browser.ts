import { chromium, type Browser } from 'playwright';

export interface LaunchBrowserOptions {
  /** Headed is for debugging a capture by watching it happen. */
  headless?: boolean;
  /** Passed straight to Chromium. `--no-sandbox` belongs to the container, not here. */
  args?: readonly string[];
}

/**
 * Raised when Playwright is installed but its browser binary is not.
 *
 * A first run on a clean machine hits this, and Playwright's own message is a
 * wall of text with the fix buried in it. A surface can print `installCommand`
 * and nothing else.
 */
export class BrowserNotInstalledError extends Error {
  override readonly name = 'BrowserNotInstalledError';
  readonly installCommand = 'npx playwright install chromium';
  constructor(cause: unknown) {
    super(
      'Chromium is not installed for this Playwright version. Run `npx playwright install chromium` and try again.',
      { cause },
    );
  }
}

/**
 * Launch the browser a scan runs in.
 *
 * It lives here rather than in a surface because **this package owns the
 * browser**: `captureState` promises never to mutate the target page, axe has to
 * run in the same load the capture came from, and the keyboard walk presses real
 * keys. Those guarantees are about how the browser is driven, so the decision to
 * open one belongs beside them — a CLI or a server asks for a scan, not for a
 * Chromium.
 */
export async function launchChromium(options: LaunchBrowserOptions = {}): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: options.headless ?? true,
      ...(options.args === undefined ? {} : { args: [...options.args] }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist") || message.includes('playwright install')) {
      throw new BrowserNotInstalledError(error);
    }
    throw error;
  }
}
