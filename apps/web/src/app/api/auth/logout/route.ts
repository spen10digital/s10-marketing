import { logoutUrl, revokeRefreshToken } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { COOKIES } from '@/server/auth/cookies';
import { clearAuthCookies } from '@/server/auth/flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST only, so a link or image on another site can't sign the user out. Revokes the refresh
 * token, clears cookies and ends the managed-login session too.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(COOKIES.refreshToken)?.value;
  let target = new URL('/signed-out', request.nextUrl.origin).toString();
  try {
    const settings = await getCognitoSettings();
    if (refreshToken) await revokeRefreshToken(settings, refreshToken);
    target = logoutUrl(settings, `${settings.appUrl}/signed-out`);
  } catch {
    // Not configured: still clear local cookies.
  }
  const response = NextResponse.redirect(target, 303);
  clearAuthCookies(response);
  return response;
}
