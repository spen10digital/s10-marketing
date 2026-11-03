import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Cognito managed login with the OAuth 2.0 authorization-code flow + PKCE (02 §3.3). The web app
 * is a public client (no client secret); tokens live only in HTTP-only cookies.
 */
export interface CognitoClientConfig {
  /** Managed-login host, e.g. `s10-identity-dev.auth.us-east-2.amazoncognito.com` (no scheme). */
  domain: string;
  clientId: string;
  /** Absolute callback URL registered on the app client. */
  redirectUri: string;
}

export const OAUTH_SCOPES = 'openid email profile';

const base64url = (buf: Buffer) => buf.toString('base64url');

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: base64url(randomBytes(24)) };
}

export function domainHost(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function authorizeUrl(
  config: CognitoClientConfig,
  params: { state: string; challenge: string; screen: 'login' | 'signup' },
): string {
  // /signup opens the managed sign-up page directly; it accepts the same parameters.
  const path = params.screen === 'signup' ? 'signup' : 'oauth2/authorize';
  const url = new URL(`https://${domainHost(config.domain)}/${path}`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: OAUTH_SCOPES,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function logoutUrl(config: CognitoClientConfig, logoutUri: string): string {
  const url = new URL(`https://${domainHost(config.domain)}/logout`);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: logoutUri }).toString();
  return url.toString();
}

const tokenResponse = z.object({
  access_token: z.string(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});
export type TokenResponse = z.infer<typeof tokenResponse>;

type Fetch = typeof fetch;

async function tokenRequest(config: CognitoClientConfig, body: Record<string, string>, fetchImpl: Fetch) {
  const res = await fetchImpl(`https://${domainHost(config.domain)}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...body }).toString(),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Never include the response body: it can echo codes or tokens.
    throw new AppError('UNAUTHENTICATED', `Sign-in failed (token endpoint returned ${res.status}).`);
  }
  const parsed = tokenResponse.safeParse(await res.json());
  if (!parsed.success)
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Unexpected response from the sign-in service.');
  return parsed.data;
}

export function exchangeCode(
  config: CognitoClientConfig,
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(
    config,
    { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier },
    fetchImpl,
  );
}

export function refreshTokens(
  config: CognitoClientConfig,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
}

/** Best effort: revokes the refresh token (and the access tokens issued from it) at sign-out. */
export async function revokeRefreshToken(
  config: CognitoClientConfig,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await fetchImpl(`https://${domainHost(config.domain)}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, token: refreshToken }).toString(),
    cache: 'no-store',
  }).catch(() => undefined);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Only same-site relative paths, so the login flow can't be used as an open redirect. */
export function safeReturnTo(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const url = new URL(value, 'https://placeholder.invalid');
    if (url.origin !== 'https://placeholder.invalid') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

/** Short-lived cookie payload carrying the PKCE verifier and state between login and callback. */
export const oauthTransaction = z.object({
  state: z.string().min(16),
  verifier: z.string().min(43),
  returnTo: z.string(),
});
export type OAuthTransaction = z.infer<typeof oauthTransaction>;

export function encodeOAuthTransaction(tx: OAuthTransaction): string {
  return Buffer.from(JSON.stringify(tx)).toString('base64url');
}

export function decodeOAuthTransaction(value: string | undefined): OAuthTransaction | null {
  if (!value) return null;
  try {
    const parsed = oauthTransaction.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
