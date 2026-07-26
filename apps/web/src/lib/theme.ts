/**
 * Theme choice: the logic, with no DOM in sight.
 *
 * Three states rather than a toggle, deliberately. "Follow the operating
 * system" is a real preference and the one most people are actually expressing;
 * a two-state switch silently deletes it and leaves someone who set dark mode
 * system-wide unable to say so here.
 */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** What actually gets rendered once the choice and the OS are both consulted. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'handrail:theme';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/** Anything unrecognised — absent, corrupted, from a future version — reads as `system`. */
export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return isThemeChoice(value) ? value : 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

/**
 * The value for `<html data-theme>`, or `null` to remove the attribute.
 *
 * `system` removes it rather than writing the resolved value, because
 * `theme.css` already answers the OS preference on its own. Writing `light`
 * there would pin the page at the moment it loaded and stop it following a
 * preference the user changes while it is open.
 */
export function themeAttribute(choice: ThemeChoice): ResolvedTheme | null {
  return choice === 'system' ? null : choice;
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
