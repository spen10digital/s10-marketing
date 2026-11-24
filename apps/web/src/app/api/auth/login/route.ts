import { authorizeUrl, createPkce, safeReturnTo, seal, AUTH_TX_TTL_SECONDS } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { cookieOptions } from '@/server/auth/cookies';
import { authErrorResponse } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts sign-in on the Suite's managed login (code flow with PKCE). State, nonce and the PKCE
 * verifier wait in a short-lived sealed cookie. `?screen=signup` opens the sign-up page.
 */
export async function GET(request: NextRequest) {
  try {
    const settings = await getCognitoSettings();
    const { verifier, challenge, state, nonce } = createPkce();
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
    const screen = request.nextUrl.searchParams.get('screen') === 'signup' ? 'signup' : 'login';

    const response = NextResponse.redirect(authorizeUrl(settings, { state, challenge, nonce, screen }));
    response.cookies.set(
      settings.names.authTx,
      await seal({ state, verifier, nonce, returnTo }, settings.secret, AUTH_TX_TTL_SECONDS),
      cookieOptions(settings.secureCookies, AUTH_TX_TTL_SECONDS),
    );
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
