import type { JSX, ReactNode } from 'react';

import { ThemeControl } from './ThemeControl.js';

const REPO_URL = 'https://github.com/vrajjshah/handrail';

/** In-page sections the banner navigation points at. Real targets, never a `#`. */
const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#coverage', label: 'Honest coverage' },
] as const;

/**
 * The application shell: skip link, banner, navigation, main, footer.
 *
 * Landmarks appear exactly once each and every one is either implicit in the
 * element or named, per docs/DESIGN.md §7.1. The order of the DOM is the order
 * of the page — nothing here is repositioned by CSS, because a keyboard user
 * moving through a layout that disagrees with what they can see is the failure
 * this shell exists to avoid.
 */
export function Shell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      {/*
       * First focusable thing in the document, hidden until it is focused. It
       * has to be a real anchor to a real id: `#main` is `tabindex="-1"` so the
       * jump lands somewhere that can actually take focus, which is the part
       * skip links most often get wrong.
       */}
      {/*
       * Every visual style is behind `focus:`, including the padding.
       * `sr-only` sets `padding: 0` and a 1px box; an unconditional `px-4 py-2`
       * overrides that and inflates the hidden link into a 32×16 pointer
       * target — which our own `ptr.target-size` check flagged as a 2.5.8
       * violation on this page, correctly, once the stacked header put another
       * target next to it.
       */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to main content
      </a>

      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-surface-raised">
          {/*
           * Stacked below `md`, in a row above it. Wrapping a row at 320px put
           * the wordmark beside a three-line list and read as broken layout
           * rather than as reflow — 1.4.10 asks for content that survives the
           * narrow viewport, not content that merely fits in it.
           */}
          <div className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-col gap-3 px-4 py-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-4 md:px-8">
            <a
              href="/"
              className="text-subheading font-semibold text-text no-underline"
              aria-label="Handrail, home"
            >
              Handrail
            </a>

            <nav aria-label="Main" className="md:flex-1">
              {/*
               * `role="list"` on a list whose markers Tailwind's reset removed.
               * Safari drops list semantics entirely when `list-style: none` is
               * applied, so VoiceOver stops announcing "list, 3 items" — the
               * one piece of structure a navigation list exists to convey.
               */}
              <ul role="list" className="flex flex-wrap items-center gap-4">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-small text-accent-text">
                      {link.label}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href={REPO_URL}
                    className="text-small text-accent-text"
                    rel="noreferrer noopener"
                  >
                    Source on GitHub
                  </a>
                </li>
              </ul>
            </nav>

            <ThemeControl />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-(--breakpoint-lg) flex-1 px-4 py-8 md:px-8"
        >
          {children}
        </main>

        <footer
          data-surface="inverse"
          className="bg-surface-inverse text-text-inverse"
        >
          <div className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-col gap-3 px-4 py-8 text-small md:px-8">
            <p className="max-w-prose">
              Handrail reports what it can evidence and lists what it cannot test. No automated
              tool can tell you a site is accessible, and this one will not pretend otherwise.
            </p>
            <ul role="list" className="flex flex-wrap gap-4">
              <li>
                <a href={REPO_URL} className="text-text-inverse" rel="noreferrer noopener">
                  Source on GitHub
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/LICENSE`}
                  className="text-text-inverse"
                  rel="noreferrer noopener"
                >
                  MIT licence
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/docs/DESIGN.md`}
                  className="text-text-inverse"
                  rel="noreferrer noopener"
                >
                  How this interface is built
                </a>
              </li>
            </ul>
          </div>
        </footer>
      </div>
    </>
  );
}
