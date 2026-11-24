import { exchangeCode, safeEqual, safeReturnTo, unseal } from '@s10/core/auth';
import { AppError } from '@s10/core/errors';
import { NextResponse, type NextRequest } from 'next/server';
import { getCognitoSettings } from '@/server/auth/cognito';
import { authErrorResponse } from '@/server/auth/errors';
import { establishSession } from '@/server/auth/flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The first request after Aurora has paused can take ~20 s while it resumes.
export const maxDuration = 60;

/** The Suite's managed login redirects here with `code` and `state`. */
export async function GET(request: NextRequest) {
  try {
    const settings = await getCognitoSettings();
    const params = request.nextUrl.searchParams;
    const tx = await unseal(request.cookies.get(settings.names.authTx)?.value, settings.secret);
    const state = params.get('state');
    const code = params.get('code');
    if (
      !tx ||
      typeof tx.state !== 'string' ||
      typeof tx.verifier !== 'string' ||
      typeof tx.nonce !== 'string' ||
      !state ||
      !safeEqual(state, tx.state)
    ) {
      throw new AppError('UNAUTHENTICATED', 'Sign-in session expired or was tampered with.');
    }
    if (!code) throw new AppError('UNAUTHENTICATED', 'Sign-in was cancelled.');

    const tokens = await exchangeCode(settings, code, tx.verifier);
    const returnTo = safeReturnTo(typeof tx.returnTo === 'string' ? tx.returnTo : undefined);
    const response = NextResponse.redirect(new URL(returnTo, settings.appUrl));
    await establishSession(tokens, response, { nonce: tx.nonce });
    response.cookies.delete(settings.names.authTx);
    return response;
  } catch (err) {
    return authErrorResponse(err, request);
  }
}
