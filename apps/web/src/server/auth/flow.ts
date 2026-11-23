import 'server-only';
import { registerUser } from '@s10/core/domain';
import { seal, sessionPayload, SESSION_TTL_SECONDS, type TokenResponse } from '@s10/core/auth';
import { AppError } from '@s10/core/errors';
import type { NextResponse } from 'next/server';
import { getDb } from '../db';
import { getVerifiers, type CognitoSettings } from './cognito';
import { allCookieNames, cookieOptions } from './cookies';

export interface EstablishOptions {
  /** The nonce sent at login. Required when the response carries an ID token (sign-in). */
  nonce?: string;
  /** Who was signed in before, for a refresh (which carries no ID token). */
  previous?: { email?: string; name?: string };
}

/**
 * Verifies freshly issued tokens, makes sure the user row exists (first sign-in creates it, or
 * links an existing user by VERIFIED email; there is no Cognito trigger, see ADR 0014) and keeps
 * the person's tokens in sealed, host-only, HTTP-only cookies.
 */
export async function establishSession(
  tokens: TokenResponse,
  response: NextResponse,
  options: EstablishOptions = {},
): Promise<void> {
  const { settings, verifiers } = await getVerifiers();
  const access = await verifiers.access.verify(tokens.access_token);
  let email = options.previous?.email;
  let name = options.previous?.name;

  if (tokens.id_token) {
    const id = await verifiers.id.verify(tokens.id_token);
    if (id.sub !== access.sub) throw new AppError('UNAUTHENTICATED', 'Sign-in tokens do not match.');
    const nonce = (id as { nonce?: unknown }).nonce;
    if (!options.nonce || nonce !== options.nonce) {
      throw new AppError('UNAUTHENTICATED', 'Sign-in session expired or was tampered with.');
    }
    // Linking an existing user by email is only safe when the email is verified.
    if (id.email_verified !== true || typeof id.email !== 'string') {
      throw new AppError('FORBIDDEN', 'Please verify your email address before signing in.');
    }
    email = id.email;
    name = typeof id.name === 'string' ? id.name : undefined;
    await registerUser(await getDb(), {
      issuer: settings.issuer,
      subject: id.sub,
      email,
      displayName: name,
    });
  }

  await setSessionCookies(response, settings, {
    sub: access.sub,
    email,
    name,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken: tokens.refresh_token,
  });
}

export async function setSessionCookies(
  response: NextResponse,
  settings: CognitoSettings,
  s: {
    sub: string;
    email?: string;
    name?: string;
    accessToken: string;
    expiresIn: number;
    refreshToken?: string;
  },
): Promise<void> {
  const options = cookieOptions(settings.secureCookies, SESSION_TTL_SECONDS);
  response.cookies.set(
    settings.names.session,
    await seal(sessionPayload(s), settings.secret, SESSION_TTL_SECONDS),
    options,
  );
  if (s.refreshToken) {
    response.cookies.set(
      settings.names.refresh,
      await seal({ rt: s.refreshToken }, settings.secret, SESSION_TTL_SECONDS),
      options,
    );
  }
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of allCookieNames()) response.cookies.delete(name);
}
