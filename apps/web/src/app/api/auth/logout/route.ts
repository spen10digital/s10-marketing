import { logoutUrl, revokeRefreshToken, unseal } from '@s10/core/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { clearAuthCookies } from '@/server/auth/flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST only, so a link or image on another site can't sign the user out. Revokes the refresh
 * token, clears cookies and ends the Suite's managed-login session too.
 */
export async function POST(request: NextRequest) {
  let target = new URL('/signed-out', request.nextUrl.origin).toString();
  try {
    const settings = await getCognitoSettings();
    const refresh = await unseal(request.cookies.get(settings.names.refresh)?.value, settings.secret);
    if (typeof refresh?.rt === 'string') await revokeRefreshToken(settings, refresh.rt);
    target = logoutUrl(settings, `${settings.appUrl}/signed-out`);
  } catch {
    // Not configured: still clear local cookies.
  }
  const response = NextResponse.redirect(target, 303);
  clearAuthCookies(response);
  return response;
}
