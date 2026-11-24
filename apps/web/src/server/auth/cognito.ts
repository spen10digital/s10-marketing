import 'server-only';
import { decodeSessionSecret, type CognitoClientConfig } from '@s10/core/auth';
import { AppError } from '@s10/core/errors';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { AWS_REGION } from '../aws';
import { getConfig } from '../config';
import { cookieNames, type CookieNames } from './cookies';

/**
 * Sign-in goes through S10/Suite's shared Cognito pool (`login.spen10.com`) with this app's own
 * client; the app then keeps its own sealed, host-only session. All values come from config:
 * COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN, SUITE_URL, S10_APP_ID (and the one
 * secret, SUITE_SESSION_SECRET, from the environment).
 */
export interface CognitoSettings extends CognitoClientConfig {
  userPoolId: string;
  issuer: string;
  appUrl: string;
  secureCookies: boolean;
  suiteUrl: string;
  appId: string;
  secret: Uint8Array;
  names: CookieNames;
}

export async function getCognitoSettings(): Promise<CognitoSettings> {
  const config = await getConfig();
  const { COGNITO_USER_POOL_ID: userPoolId, COGNITO_CLIENT_ID: clientId, COGNITO_DOMAIN: domain } = config;
  if (!userPoolId || !clientId || !domain || !config.SUITE_URL) {
    throw new AppError('CONFIG_INVALID', 'Sign-in is not configured for this environment.');
  }
  const appUrl = config.APP_URL.replace(/\/+$/, '');
  const secureCookies = appUrl.startsWith('https://');
  return {
    userPoolId,
    clientId,
    domain,
    appUrl,
    redirectUri: `${appUrl}/api/auth/callback`,
    issuer: `https://cognito-idp.${AWS_REGION}.amazonaws.com/${userPoolId}`,
    secureCookies,
    suiteUrl: config.SUITE_URL.replace(/\/+$/, ''),
    appId: config.S10_APP_ID,
    secret: decodeSessionSecret(config.SUITE_SESSION_SECRET),
    names: cookieNames(secureCookies),
  };
}

type Verifiers = {
  access: ReturnType<typeof createAccessVerifier>;
  id: ReturnType<typeof createIdVerifier>;
};
const createAccessVerifier = (s: CognitoSettings) =>
  CognitoJwtVerifier.create({ userPoolId: s.userPoolId, clientId: s.clientId, tokenUse: 'access' });
const createIdVerifier = (s: CognitoSettings) =>
  CognitoJwtVerifier.create({ userPoolId: s.userPoolId, clientId: s.clientId, tokenUse: 'id' });

let verifiers: { key: string; value: Verifiers } | undefined;

/** Verifiers check signature (cached JWKS), issuer, audience/client_id, token_use and expiry. */
export async function getVerifiers(): Promise<{ settings: CognitoSettings; verifiers: Verifiers }> {
  const settings = await getCognitoSettings();
  const key = `${settings.userPoolId}:${settings.clientId}`;
  if (verifiers?.key !== key) {
    verifiers = { key, value: { access: createAccessVerifier(settings), id: createIdVerifier(settings) } };
  }
  return { settings, verifiers: verifiers.value };
}
