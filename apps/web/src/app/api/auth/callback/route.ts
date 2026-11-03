import { decodeOAuthTransaction, exchangeCode, safeEqual } from '@s10/core/auth';
import { AppError } from '@s10/core/errors';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { COOKIES } from '@/server/auth/cookies';
import { authErrorResponse } from '@/server/auth/errors';
import { establishSession } from '@/server/auth/flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The first request after Aurora has paused can take ~20 s while it resumes.
export const maxDuration = 60;

/** Managed login redirects here with `code` and `state`. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const pending = decodeOAuthTransaction(request.cookies.get(COOKIES.oauth)?.value);
    const state = params.get('state');
    const code = params.get('code');
    if (!pending || !state || !safeEqual(state, pending.state)) {
      throw new AppError('UNAUTHENTICATED', 'Sign-in session expired or was tampered with.');
    }
    if (!code) throw new AppError('UNAUTHENTICATED', 'Sign-in was cancelled.');

    const settings = await getCognitoSettings();
    const tokens = await exchangeCode(settings, code, pending.verifier);
    const response = NextResponse.redirect(new URL(pending.returnTo, settings.appUrl));
    await establishSession(tokens, response);
    response.cookies.delete(COOKIES.oauth);
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
