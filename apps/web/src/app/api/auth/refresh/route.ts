import { refreshTokens, safeReturnTo, unseal } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { authErrorResponse } from '@/server/auth/errors';
import { establishSession } from '@/server/auth/flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pages redirect here when the access token (60 min) has expired but a refresh token exists.
 * Server components cannot set cookies, so refreshing is its own hop.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const toLogin = () =>
    NextResponse.redirect(
      new URL(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
    );
  try {
    const settings = await getCognitoSettings();
    const refresh = await unseal(request.cookies.get(settings.names.refresh)?.value, settings.secret);
    if (typeof refresh?.rt !== 'string') return toLogin();
    // Keep who this is; a refresh response carries no ID token. Readable even after the access token ran out.
    const previous = await unseal(request.cookies.get(settings.names.session)?.value, settings.secret);

    const tokens = await refreshTokens(settings, refresh.rt);
    const response = NextResponse.redirect(new URL(returnTo, settings.appUrl));
    // Cognito does not return a new refresh token here, so the sealed one stays as it is.
    await establishSession(tokens, response, {
      previous: {
        email: typeof previous?.email === 'string' ? previous.email : undefined,
        name: typeof previous?.name === 'string' ? previous.name : undefined,
      },
    });
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
