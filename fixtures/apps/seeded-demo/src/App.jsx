import { useRef, useState } from 'react';

/**
 * Northwind Supper Club — a deliberately broken restaurant site.
 *
 * Every accessibility defect in here is intentional and recorded in
 * `ground-truth.json` by its `data-gt` attribute. Elements marked `data-trap`
 * are correct and must NOT be reported; they are how we measure false positives.
 *
 * Rules for editing this file:
 *   1. Never fix a seeded issue. Remove it from ground-truth.json first, in the
 *      same commit, with a reason.
 *   2. Keep `data-gt` / `data-trap` values stable — the eval harness matches
 *      findings to ground truth through them.
 */

function Header() {
  return (
    <header className="site">
      <div className="wordmark">Northwind Supper Club</div>
      <nav className="site">
        <ul>
          {/*
            SEEDED ISSUE gt-008 (WCAG 2.4.3): a single positive tabindex pulls
            "Contact" to the front of the tab sequence, so it receives focus
            before "Menu" and "Cellar" — which precede it visually and in the
            DOM. The other two links are left at their natural order.
          */}
          <li>
            <a href="#menu">Menu</a>
          </li>
          <li>
            <a href="#cellar">Cellar</a>
          </li>
          <li>
            <a href="#contact" data-gt="gt-008" tabIndex={1}>
              Contact
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="card">
      <h1>An eight-course supper, twice a week</h1>

      {/*
        SEEDED ISSUE gt-001 (WCAG 1.1.1) — the flagship case.
        The alt text is present, grammatical, and confidently wrong: the image is
        a set dinner table, not a football celebration. Every rule engine passes
        this element. Only comparing the pixels against the claim catches it.
      */}
      <img
        data-gt="gt-001"
        src="/images/dinner-table.svg"
        alt="Fans celebrating a football victory in a packed stadium"
        width="800"
        height="500"
      />

      <p className="muted-note" data-gt="gt-004">
        Seatings are released on the first Monday of each month and tend to go within the hour.
      </p>

      <p className="muted-note--passing" data-trap="trap-contrast-ok">
        Dietary requirements can be noted when you book; the kitchen adapts every course.
      </p>
    </section>
  );
}

function Gallery() {
  return (
    <section className="card" id="menu">
      {/*
        SEEDED ISSUE gt-013 (WCAG 1.3.1): the outline jumps from h1 straight to h3,
        so the document structure a screen-reader user navigates by is wrong.
      */}
      <h3 data-gt="gt-013">From the kitchen</h3>

      <div className="gallery">
        {/*
          SEEDED ISSUE gt-002 (WCAG 1.1.1): no alt attribute at all. This is the
          case every rule engine already catches — it is here as the control that
          proves the deterministic layer is wired up.
        */}
        <img data-gt="gt-002" src="/images/dinner-table.svg" width="260" height="163" />

        {/*
          Trap: a genuinely decorative image, correctly hidden with alt="".
          Reporting this would be a false positive.
        */}
        <img
          data-trap="trap-decorative-alt"
          src="/images/decorative-flourish.svg"
          alt=""
          width="260"
          height="26"
        />
      </div>

      {/*
        SEEDED ISSUE gt-012 (WCAG 1.4.5): opening hours exist only as pixels
        inside an SVG, so they cannot be resized, restyled or translated.
      */}
      <img
        data-gt="gt-012"
        src="/images/opening-hours.svg"
        alt="Opening hours"
        width="520"
        height="220"
      />

      <p>
        {/*
          SEEDED ISSUE gt-006 (WCAG 2.4.4): the link text carries no purpose out
          of context, which is exactly how a screen reader's link list presents it.
        */}
        Our tasting menu changes with the season.{' '}
        <a href="#menu-detail" data-gt="gt-006">
          Click here
        </a>{' '}
        to see what is on this month.
      </p>
    </section>
  );
}

function Cellar() {
  return (
    <section className="card" id="cellar">
      <h2>From the cellar</h2>

      {/*
        SEEDED ISSUE gt-007 (WCAG 1.4.10): a fixed 720px table forces two-dimensional
        scrolling once the viewport reaches 320px.
      */}
      <table className="wine-table" data-gt="gt-007">
        <thead>
          <tr>
            <th scope="col">Producer</th>
            <th scope="col">Region</th>
            <th scope="col">Year</th>
            <th scope="col">Glass</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Domaine Perrot</td>
            <td>Loire</td>
            <td>2021</td>
            <td>£9</td>
          </tr>
          <tr>
            <td>Keller &amp; Sohn</td>
            <td>Rheinhessen</td>
            <td>2019</td>
            <td>£12</td>
          </tr>
          <tr>
            <td>Quinta do Vale</td>
            <td>Douro</td>
            <td>2018</td>
            <td>£11</td>
          </tr>
        </tbody>
      </table>

      <p>
        {/*
          SEEDED ISSUE gt-009 (WCAG 2.5.8): an 18x18 target sat flush against a
          full-size one, so its 24px spacing circle intersects a neighbouring
          target and the spacing exception does NOT rescue it. The full-size
          neighbour passes on size, so only the undersized button fails.
        */}
        <span className="stepper">
          <button type="button" className="icon-button--small" data-gt="gt-009" aria-label="One more bottle of Domaine Perrot">
            +
          </button>
          <button type="button" className="icon-button--ok" aria-label="Add Domaine Perrot to my list">
            Add
          </button>
        </span>{' '}
        to list
      </p>

      <p>
        {/* Trap: exactly 24x24, which passes 2.5.8 on size. Must NOT be reported. */}
        <button
          type="button"
          className="icon-button--ok"
          data-trap="trap-target-size-ok"
          aria-label="Add Keller und Sohn to my list"
        >
          +
        </button>{' '}
        add to list
      </p>

      <p>
        {/*
          Trap: an 18x18 target that is under the minimum but ISOLATED — the
          nearest other target is far more than 24px away, so its 24px spacing
          circle intersects nothing and the spacing exception passes it. A check
          that flags every undersized target without the exception ladder reports
          this, and drowns real sites in false positives. Must NOT be reported.
        */}
        <button
          type="button"
          className="icon-button--small"
          data-trap="trap-target-size-spacing"
          aria-label="Add Quinta do Vale to my list"
        >
          +
        </button>{' '}
        add to list
      </p>
    </section>
  );
}

function BookingForm() {
  return (
    <section className="card" id="contact">
      <h2>Book a table</h2>

      <p>
        Fields marked <span className="required-by-colour" data-gt="gt-010">in red</span> are required.
      </p>

      <form>
        {/*
          SEEDED ISSUE gt-003 (WCAG 3.3.2 / 4.1.2): a placeholder is not a label.
          It disappears on focus and is not reliably exposed as an accessible name.
        */}
        <div className="field">
          <input data-gt="gt-003" type="email" placeholder="Email address" />
        </div>

        {/* Trap: correctly labelled control. Must NOT be reported. */}
        <div className="field">
          <label htmlFor="party-size">Number of guests</label>
          <select id="party-size" data-trap="trap-labelled-control" defaultValue="2">
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="6">6</option>
          </select>
        </div>

        <button type="submit" className="primary keeps-focus-ring" data-trap="trap-focus-ring-ok">
          Request a seating
        </button>
      </form>
    </section>
  );
}

/**
 * SEEDED ISSUE gt-005 (WCAG 2.4.7) lives in styles.css — focus outlines are
 * suppressed globally. This button is the element the check should land on.
 *
 * SEEDED ISSUE gt-014 (WCAG 2.1.2): the textbook broken modal. Tab and
 * Shift+Tab are intercepted and cycled between the two controls inside the
 * dialog, and there is no Escape handler and no reachable close control. A
 * keyboard user who opens this cannot get out except by reloading the page.
 */
function NewsletterDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  // Intercepting Tab is what makes this a trap rather than merely untidy focus
  // management, and it is why the check has to press real keys: nothing in the
  // markup gives this away.
  const cycleFocusWithin = (event) => {
    if (event.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;

    const focusable = [...node.querySelectorAll('input, button, select, a[href]')];
    if (focusable.length === 0) return;

    const current = focusable.indexOf(document.activeElement);
    const step = event.shiftKey ? -1 : 1;
    const next = focusable[(current + step + focusable.length) % focusable.length];

    event.preventDefault();
    next.focus();
  };

  if (!open) {
    return (
      <section className="card">
        <h2>Supper notes</h2>
        <p>A short letter each month: what is coming in, and when seatings open.</p>
        <button type="button" className="primary no-focus-ring" data-gt="gt-005" onClick={() => setOpen(true)}>
          Join the list
        </button>
      </section>
    );
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-label="Join the supper notes list"
        data-gt="gt-014"
        ref={dialogRef}
        onKeyDown={cycleFocusWithin}
      >
        <h2>Supper notes</h2>
        <div className="field">
          <label htmlFor="newsletter-email">Email address</label>
          <input id="newsletter-email" type="email" autoFocus />
        </div>
        <button type="button" className="primary">
          Subscribe
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="page">
      <Header />
      <main>
        <Hero />
        <Gallery />
        <Cellar />
        <BookingForm />
        <NewsletterDialog />
      </main>
      <footer className="site">
        <p className="muted-note--passing">
          Northwind Supper Club, 14 Harbour Lane. A fixture app; nothing here is a real business.
        </p>
      </footer>
    </div>
  );
}
