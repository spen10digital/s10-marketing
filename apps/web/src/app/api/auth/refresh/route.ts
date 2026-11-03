import { refreshTokens, safeReturnTo } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { COOKIES } from '@/server/auth/cookies';
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
  const refreshToken = request.cookies.get(COOKIES.refreshToken)?.value;
  if (!refreshToken) {
    return NextResponse.redirect(
      new URL(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
    );
  }
  try {
    const settings = await getCognitoSettings();
    const tokens = await refreshTokens(settings, refreshToken);
    const response = NextResponse.redirect(new URL(returnTo, settings.appUrl));
    await establishSession(tokens, response);
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
