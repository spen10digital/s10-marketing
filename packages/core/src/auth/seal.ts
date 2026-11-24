import { base64url, EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';
import { AppError } from '../errors/app-error';

/**
 * Sealed cookies: a small payload encrypted into one cookie value (JWE, `dir` + A256GCM) that
 * expires after a TTL. Only the server holding the secret can read or create one, so a sealed
 * cookie is trusted without re-verifying what is inside it. Same scheme as the other S10 apps.
 */

/** The 32-byte key from `SUITE_SESSION_SECRET` (base64url). Throws CONFIG_INVALID, never echoing the value. */
export function decodeSessionSecret(raw: string | undefined): Uint8Array {
  const value = raw?.trim();
  if (!value) throw new AppError('CONFIG_INVALID', 'SUITE_SESSION_SECRET is not set.');
  let key: Uint8Array;
  try {
    key = base64url.decode(value);
  } catch {
    throw new AppError('CONFIG_INVALID', 'SUITE_SESSION_SECRET must be base64url encoded.');
  }
  if (key.length !== 32) {
    throw new AppError('CONFIG_INVALID', 'SUITE_SESSION_SECRET must be 32 random bytes, base64url encoded.');
  }
  return key;
}

export async function seal(
  payload: JWTPayload,
  secret: Uint8Array,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .encrypt(secret);
}

/** The payload, or null when the value is missing, tampered with, from another key or expired. */
export async function unseal(
  value: string | undefined,
  secret: Uint8Array,
  now: number = Date.now(),
): Promise<JWTPayload | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, secret, { currentDate: new Date(now) });
    return payload;
  } catch {
    return null;
  }
}

/** How long the app's own session lasts before going back to the Suite (silent while the login lasts). */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** State, nonce and PKCE verifier between login and callback. */
export const AUTH_TX_TTL_SECONDS = 10 * 60;

/** What the session cookie holds. Names are short to keep the cookie small. */
export interface SessionTokens {
  sub: string;
  email?: string;
  name?: string;
  /** Cognito access token: sent to the Suite API as a bearer token. */
  accessToken: string;
  /** Access token expiry, epoch seconds. */
  accessTokenExp: number;
}

export function sessionPayload(
  s: { sub: string; email?: string; name?: string; accessToken: string; expiresIn: number },
  now: number = Date.now(),
): JWTPayload {
  return {
    sub: s.sub,
    email: s.email,
    name: s.name,
    at: s.accessToken,
    atExp: Math.floor(now / 1000) + s.expiresIn,
  };
}

/** The session, or null when the payload is incomplete or the access token has run out. */
export function readSession(payload: JWTPayload | null, now: number = Date.now()): SessionTokens | null {
  if (!payload) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.at !== 'string' || typeof payload.atExp !== 'number') return null;
  if (payload.atExp * 1000 <= now) return null;
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    accessToken: payload.at,
    accessTokenExp: payload.atExp,
  };
}
