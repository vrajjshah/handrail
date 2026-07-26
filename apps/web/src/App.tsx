import type { JSX } from 'react';

import { Shell } from './components/Shell.js';

/** A tier badge. Colour is reinforcement; the word is the message. */
function Badge({ tone, children }: { tone: 'violation' | 'likely' | 'review'; children: string }): JSX.Element {
  const tones = {
    violation: 'bg-violation-surface text-violation border-violation-border',
    likely: 'bg-likely-surface text-likely border-likely-border',
    review: 'bg-review-surface text-review border-review-border',
  } as const;
  return (
    <span className={`inline-block rounded-sm border px-2 py-px text-small ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function App(): JSX.Element {
  return (
    <Shell>
      <h1 className="text-title font-semibold text-balance">
        The open-source AI accessibility engineer
      </h1>
      <p className="mt-4 max-w-prose text-text-muted">
        Handrail scans a site against WCAG 2.2 A and AA, and shows you the evidence for every
        single thing it claims. Rule engines catch roughly a third of real problems. The rest
        needs judgment — so Handrail applies it, then makes that judgment prove itself before it
        reaches you.
      </p>

      <section
        aria-labelledby="scan-heading"
        className="mt-8 rounded-lg border border-border bg-surface-raised p-6"
      >
        <h2 id="scan-heading" className="text-heading font-semibold">
          Scan a site
        </h2>
        <p className="mt-2 max-w-prose text-text-muted">
          The scan form arrives with the API it talks to. This shell is the ground it stands on:
          landmarks, headings, focus order and the design tokens, built first so that nothing
          after it has to re-earn them.
        </p>
      </section>

      <section aria-labelledby="how-it-works" className="mt-12">
        <h2 id="how-it-works" className="text-heading font-semibold">
          How it works
        </h2>
        <ol role="list" className="mt-4 flex flex-col gap-4">
          <li>
            <h3 className="text-subheading font-semibold">Capture once, judge many</h3>
            <p className="max-w-prose text-text-muted">
              One pass over the page records the DOM, the accessibility tree Chromium itself
              computed, an index of every element, and screenshots. Every later check reads that
              capture instead of re-loading the page.
            </p>
          </li>
          <li>
            <h3 className="text-subheading font-semibold">Rules, then heuristics, then judgment</h3>
            <p className="max-w-prose text-text-muted">
              axe-core runs first. Then keyboard traversal with real Tab presses, target sizing,
              and reflow at 320 pixels. Only what is left over goes to a model.
            </p>
          </li>
          <li>
            <h3 className="text-subheading font-semibold">Nothing ships unevidenced</h3>
            <p className="max-w-prose text-text-muted">
              Every AI claim is grounded against the captured DOM, re-checked deterministically,
              and put to an independent verifier that never sees the first model&rsquo;s
              reasoning. What fails goes to a rejection ledger, not to you.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="coverage" className="mt-12">
        <h2 id="coverage" className="text-heading font-semibold">
          Honest coverage
        </h2>
        <p className="mt-4 max-w-prose text-text-muted">
          Handrail never gives you a number out of 100. It tells you which of the 55 A and AA
          criteria it evaluated, which it could evidence a pass for, and which need a human —
          and it lists that last group rather than quietly leaving it out.
        </p>
        <p className="mt-4 max-w-prose text-text-muted">
          Findings carry the tier the evidence earns, and no more:
        </p>
        <dl className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <dt>
              <Badge tone="violation">violation</Badge>
            </dt>
            <dd className="max-w-prose text-text-muted">
              Deterministic evidence. A rule or a measurement, reproducible without a model.
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <dt>
              <Badge tone="likely">likely</Badge>
            </dt>
            <dd className="max-w-prose text-text-muted">
              AI judgment that an independent verifier agreed with. The ceiling for anything a
              model decided.
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <dt>
              <Badge tone="review">needs review</Badge>
            </dt>
            <dd className="max-w-prose text-text-muted">
              Something worth a person&rsquo;s attention that the tool will not claim on its own.
            </dd>
          </div>
        </dl>
      </section>
    </Shell>
  );
}
