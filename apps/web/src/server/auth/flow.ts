import 'server-only';
import type { TokenResponse } from '@s10/core/auth';
import { AppError } from '@s10/core/errors';
import { registerUser } from '@s10/core/domain';
import type { NextResponse } from 'next/server';
import { getDb } from '../db';
import type { CognitoSettings } from './cognito';
import { getVerifiers } from './cognito';
import { COOKIES, cookieOptions, REFRESH_TOKEN_MAX_AGE } from './cookies';

/**
 * Verifies freshly issued tokens, makes sure the user row exists (first sign-in creates it;
 * there is no Cognito trigger, see ADR 0014) and stores the tokens in HTTP-only cookies.
 */
export async function establishSession(tokens: TokenResponse, response: NextResponse): Promise<void> {
  const { settings, verifiers } = await getVerifiers();
  const access = await verifiers.access.verify(tokens.access_token);

  if (tokens.id_token) {
    const id = await verifiers.id.verify(tokens.id_token);
    if (id.sub !== access.sub) throw new AppError('UNAUTHENTICATED', 'Sign-in tokens do not match.');
    if (id.email_verified !== true || typeof id.email !== 'string') {
      throw new AppError('FORBIDDEN', 'Please verify your email address before signing in.');
    }
    await registerUser(await getDb(), {
      issuer: settings.issuer,
      subject: id.sub,
      email: id.email,
      displayName: typeof id.name === 'string' ? id.name : undefined,
    });
  }

  setTokenCookies(response, settings, tokens);
}

export function setTokenCookies(response: NextResponse, settings: CognitoSettings, tokens: TokenResponse) {
  response.cookies.set(
    COOKIES.accessToken,
    tokens.access_token,
    cookieOptions(settings.secureCookies, tokens.expires_in),
  );
  if (tokens.refresh_token) {
    response.cookies.set(
      COOKIES.refreshToken,
      tokens.refresh_token,
      cookieOptions(settings.secureCookies, REFRESH_TOKEN_MAX_AGE),
    );
  }
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [COOKIES.accessToken, COOKIES.refreshToken, COOKIES.oauth, COOKIES.currentOrg]) {
    response.cookies.delete(name);
  }
}
