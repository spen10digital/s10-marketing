import { authorizeUrl, createPkce, encodeOAuthTransaction, safeReturnTo } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { COOKIES, cookieOptions } from '@/server/auth/cookies';
import { authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts managed login (`?screen=signup` opens the sign-up page). */
export async function GET(request: NextRequest) {
  try {
    const settings = await getCognitoSettings();
    const { verifier, challenge, state } = createPkce();
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
    const screen = request.nextUrl.searchParams.get('screen') === 'signup' ? 'signup' : 'login';

    const response = NextResponse.redirect(authorizeUrl(settings, { state, challenge, screen }));
    response.cookies.set(
      COOKIES.oauth,
      encodeOAuthTransaction({ state, verifier, returnTo }),
      cookieOptions(settings.secureCookies, 10 * 60),
    );
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
