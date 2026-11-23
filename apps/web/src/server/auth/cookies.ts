import 'server-only';

/**
 * Cookies are host-only (no Domain), HTTP-only and never shared across subdomains. The session
 * and refresh cookies are sealed (encrypted) with `SUITE_SESSION_SECRET`. `__Host-` names need
 * HTTPS, so plain names are used on http://localhost.
 */
export function cookieNames(secure: boolean) {
  const p = secure ? '__Host-' : '';
  return {
    /** sub, email and the Cognito access token for calling the Suite API (sealed). */
    session: `${p}s10mkt_session`,
    /** The refresh token, kept apart so each cookie stays well under 4 KB (sealed). */
    refresh: `${p}s10mkt_refresh`,
    /** State, nonce and PKCE verifier during sign-in (sealed). */
    authTx: `${p}s10mkt_auth`,
    /** The organization picked in this app: only a preference, never trusted (see org-context). */
    currentOrg: `${p}s10mkt_org`,
    /** The person's theme and light/dark choice as the Suite has it (see lib/theme). */
    prefs: `${p}s10mkt_prefs`,
  } as const;
}

export type CookieNames = ReturnType<typeof cookieNames>;

/** Every name either form can take, for clearing cookies when the config is not readable. */
export function allCookieNames(): string[] {
  return [...Object.values(cookieNames(true)), ...Object.values(cookieNames(false))];
}

export function cookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge };
}
