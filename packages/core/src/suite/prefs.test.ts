import { describe, expect, it } from 'vitest';
import { PREFS_REFRESH_MS, parsePrefsCookie, prefsCookieValue, prefsStale } from './prefs';

const isTheme = (id: string) => ['spen10', 'aurora', 'lagoon', 'nebula'].includes(id);

describe('theme and mode cookie (mirrors the Suite preferences)', () => {
  it('round-trips and rejects unknown themes, modes and garbage', () => {
    const value = prefsCookieValue('aurora', 'dark', 1000);
    expect(parsePrefsCookie(value, isTheme)).toEqual({ theme: 'aurora', mode: 'dark', at: 1000 });
    expect(parsePrefsCookie('nope:dark:1', isTheme)).toBeNull();
    expect(parsePrefsCookie('aurora:blue:1', isTheme)).toBeNull();
    expect(parsePrefsCookie('', isTheme)).toBeNull();
    expect(parsePrefsCookie(undefined, isTheme)).toBeNull();
    expect(parsePrefsCookie('aurora:dark:abc', isTheme)?.at).toBe(0);
  });

  it('asks the Suite at most once a minute', () => {
    const fresh = { theme: 'spen10', mode: 'system' as const, at: 10_000 };
    expect(prefsStale(null)).toBe(true);
    expect(prefsStale(fresh, 10_000 + PREFS_REFRESH_MS)).toBe(false);
    expect(prefsStale(fresh, 10_000 + PREFS_REFRESH_MS + 1)).toBe(true);
  });
});
