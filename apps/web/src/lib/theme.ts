import { isThemeId, themeAttributes } from '@spen10digital/s10-ui';
import { parsePrefsCookie, type PrefsCookie } from '@s10/core/suite';

export { themeAttributes };

/** The theme and light/dark cookie, or null when missing or from an unknown theme. */
export function readPrefs(value: string | undefined | null): PrefsCookie | null {
  return parsePrefsCookie(value, isThemeId);
}

export { isThemeId };
