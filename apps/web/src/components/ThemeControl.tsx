import { useState, type JSX } from 'react';
import { Label, Radio, RadioGroup } from 'react-aria-components';

import {
  THEME_CHOICES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  isThemeChoice,
  parseThemeChoice,
  themeAttribute,
} from '../lib/theme.js';
import type { ThemeChoice } from '../lib/theme.js';

function readStoredChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked entirely. Following the OS is the right default
    // and is what the page is already doing.
    return 'system';
  }
}

function applyChoice(choice: ThemeChoice): void {
  const attribute = themeAttribute(choice);
  if (attribute === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', attribute);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The theme still applies to this page; it just will not be remembered.
  }
}

/**
 * The theme control.
 *
 * A `RadioGroup` rather than three buttons or a switch: three mutually
 * exclusive options *are* a radio group, and that is what tells a screen reader
 * "System, radio button, 1 of 3" instead of leaving the relationship to be
 * inferred from how three buttons happen to be arranged. React Aria Components
 * supplies the roving tabindex and arrow-key movement, so the whole group is
 * one tab stop — which is why it is a group and not three.
 */
export function ThemeControl(): JSX.Element {
  // A lazy initialiser, not an effect. The inline script in index.html has
  // already applied the stored theme before first paint, so this only needs to
  // start React's copy in the right place — reading it in an effect would
  // render the wrong option as selected for one frame and trip
  // `react-hooks/set-state-in-effect`, which is correct to complain.
  const [choice, setChoice] = useState<ThemeChoice>(readStoredChoice);

  return (
    <RadioGroup
      // React Aria defaults a radio group to vertical, and it announces that
      // orientation. Three options laid out in a row that tell a screen reader
      // they are stacked is a small lie with real consequences for how someone
      // expects the arrow keys to behave.
      orientation="horizontal"
      value={choice}
      onChange={(value) => {
        if (!isThemeChoice(value)) return;
        setChoice(value);
        applyChoice(value);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <Label className="text-small text-text-muted">Theme</Label>
      <div className="flex rounded-md border border-border-strong">
        {THEME_CHOICES.map((option) => (
          <Radio
            key={option}
            value={option}
            className="target-min flex cursor-pointer items-center rounded-sm px-3 text-small text-text-muted data-[hovered]:text-text data-[selected]:bg-accent data-[selected]:text-on-accent"
          >
            {THEME_LABELS[option]}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
