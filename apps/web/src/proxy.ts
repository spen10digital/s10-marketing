import { readSession, unseal } from '@s10/core/auth';
import { PREFS_COOKIE_SECONDS, createSuiteClient, prefsCookieValue, prefsStale } from '@s10/core/suite';
import { NextResponse, type NextRequest } from 'next/server';
import { readPrefs } from '@/lib/theme';
import { getCognitoSettings } from '@/server/auth/cognito';
import { cookieOptions } from '@/server/auth/cookies';

/**
 * Keeps the person's theme and light/dark choice in step with the Suite, so a change made in
 * another S10 app shows here. The Suite stores it (`GET /api/v1/me/preferences`); a host-only
 * cookie mirrors it and is refreshed at most once a minute. The request carries the fresh value,
 * so the page being rendered already uses it. It never decides access: every page, action and
 * route checks the session and entitlements itself.
 *
 * Suite down, no session or an expired access token: nothing changes (the cookie keeps its
 * look and the next request asks again). Signed-out pages skip it.
 */
export async function proxy(request: NextRequest) {
  try {
    const settings = await getCognitoSettings();
    const saved = readPrefs(request.cookies.get(settings.names.prefs)?.value);
    if (!prefsStale(saved)) return NextResponse.next();

    const session = readSession(
      await unseal(request.cookies.get(settings.names.session)?.value, settings.secret),
    );
    if (!session) return NextResponse.next();
    const look = await createSuiteClient({ suiteUrl: settings.suiteUrl, appId: settings.appId }).preferences({
      accessToken: session.accessToken,
    });
    if (!look) return NextResponse.next();

    // Never saved in the Suite (a default answer): keep what this browser has, just note we asked.
    const keep = look.saved === false && saved;
    const value = keep ? prefsCookieValue(saved.theme, saved.mode) : prefsCookieValue(look.theme, look.mode);
    request.cookies.set(settings.names.prefs, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(
      settings.names.prefs,
      value,
      cookieOptions(settings.secureCookies, PREFS_COOKIE_SECONDS),
    );
    return response;
  } catch {
    // Not configured, or the Suite is down: render with what the cookie has.
    return NextResponse.next();
  }
}

export const config = {
  // Pages only: skip build assets, images and every API route (auth, health, the AI stream).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
