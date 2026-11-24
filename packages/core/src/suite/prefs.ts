/**
 * The person's theme and light/dark choice as the Suite has it (`GET/PUT /api/v1/me/preferences`),
 * kept in a host-only cookie so every page renders in the right look without waiting for the
 * Suite. `at` is when this app last asked the Suite. Format: `theme:mode:epochMs`. The same
 * format the other S10 apps use.
 */
export type PrefsMode = 'light' | 'dark' | 'system';

export interface PrefsCookie {
  theme: string;
  mode: PrefsMode;
  at: number;
}

/** The app asks the Suite whether the person changed their look in another app at most this often. */
export const PREFS_REFRESH_MS = 60 * 1000;
export const PREFS_COOKIE_SECONDS = 365 * 24 * 60 * 60;

export function isPrefsMode(value: unknown): value is PrefsMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function prefsCookieValue(theme: string, mode: string, at: number = Date.now()): string {
  return `${theme}:${mode}:${at}`;
}

/** `isTheme` is the kit's theme check, so an unknown theme id never reaches the page. */
export function parsePrefsCookie(
  value: string | undefined | null,
  isTheme: (id: string) => boolean,
): PrefsCookie | null {
  if (!value) return null;
  const [theme, mode, at] = value.split(':');
  if (!theme || !isTheme(theme) || !isPrefsMode(mode)) return null;
  const when = Number(at);
  return { theme, mode, at: Number.isFinite(when) ? when : 0 };
}

/** Should the app ask the Suite again? */
export function prefsStale(cookie: PrefsCookie | null, now: number = Date.now()): boolean {
  return !cookie || now - cookie.at > PREFS_REFRESH_MS;
}
