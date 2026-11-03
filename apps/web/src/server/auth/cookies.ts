import 'server-only';

/** All auth cookies are HTTP-only; tokens are never readable by browser JavaScript. */
export const COOKIES = {
  accessToken: 's10_at',
  refreshToken: 's10_rt',
  oauth: 's10_oauth',
  currentOrg: 's10_org',
} as const;

export const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // matches the app client's refresh token validity

export function cookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge };
}
