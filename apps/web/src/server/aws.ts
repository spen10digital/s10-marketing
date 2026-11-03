import 'server-only';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { awsCredentialsProvider } from '@vercel/functions/oidc';

/**
 * AWS credentials for server code. On Vercel, the function's OIDC token is exchanged for
 * short-lived credentials of the web runtime role (`AWS_ROLE_ARN`, created by the CDK
 * VercelAccessStack); no access keys exist anywhere. Locally, `undefined` lets the SDK use
 * the developer's SSO profile (`AWS_PROFILE`).
 */
export function awsCredentials(): AwsCredentialIdentityProvider | undefined {
  const roleArn = process.env.AWS_ROLE_ARN;
  if (!roleArn) return undefined;
  return awsCredentialsProvider({ roleArn, roleSessionName: 's10-marketing-web' });
}

export const AWS_REGION = 'us-east-2';
