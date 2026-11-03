import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizeUrl,
  createPkce,
  decodeOAuthTransaction,
  encodeOAuthTransaction,
  exchangeCode,
  logoutUrl,
  safeEqual,
  safeReturnTo,
} from './oauth';

const config = {
  domain: 's10-identity-dev.auth.us-east-2.amazoncognito.com',
  clientId: 'client123',
  redirectUri: 'https://app.example.com/api/auth/callback',
};

describe('PKCE', () => {
  it('derives an S256 challenge from a high-entropy verifier', () => {
    const { verifier, challenge, state } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(createPkce().verifier).not.toBe(verifier);
  });
});

describe('authorizeUrl', () => {
  it('requests the code flow with PKCE and the registered callback', () => {
    const url = new URL(authorizeUrl(config, { state: 's', challenge: 'c', screen: 'login' }));
    expect(url.origin + url.pathname).toBe(`https://${config.domain}/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client123',
      redirect_uri: config.redirectUri,
      scope: 'openid email profile',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
    expect(authorizeUrl(config, { state: 's', challenge: 'c', screen: 'signup' })).toContain('/signup?');
  });

  it('builds the managed-login logout URL', () => {
    const url = new URL(logoutUrl(config, 'https://app.example.com/signed-out'));
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('logout_uri')).toBe('https://app.example.com/signed-out');
  });
});

describe('exchangeCode', () => {
  it('posts the code and verifier and never leaks the error body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'a',
            id_token: 'i',
            refresh_token: 'r',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('{"error":"invalid_grant","code":"secret-code"}', { status: 400 }));

    const tokens = await exchangeCode(config, 'the-code', 'the-verifier', fetchImpl);
    expect(tokens.access_token).toBe('a');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://${config.domain}/oauth2/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('client_id')).toBe('client123');

    const err = await exchangeCode(config, 'x', 'y', fetchImpl).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret-code');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/b/loot?saved=1', '/b/loot?saved=1'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['', '/dashboard'],
    [null, '/dashboard'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe('OAuth transaction cookie', () => {
  it('round-trips and rejects garbage', () => {
    const tx = { state: 'x'.repeat(32), verifier: 'v'.repeat(43), returnTo: '/dashboard' };
    expect(decodeOAuthTransaction(encodeOAuthTransaction(tx))).toEqual(tx);
    expect(decodeOAuthTransaction('not-base64-json')).toBeNull();
    expect(decodeOAuthTransaction(undefined)).toBeNull();
  });

  it('compares state in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
