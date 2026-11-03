import { Duration, RemovalPolicy, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { paramPrefix, type EnvConfig } from './env-config';

export interface IdentityStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * The "S10 Identity" user pool (ADR 0007). It is named for S10/Suite, not for Marketing:
 * S10/Marketing is its first app client, S10/Mail and other Suite apps join later as their own
 * clients (single sign-on through managed login). LimitKeep never becomes a client.
 *
 * Sign-in uses managed login with the authorization-code flow + PKCE; the web app is a public
 * client (no secret) and keeps tokens in HTTP-only cookies (ADR 0014).
 */
export class IdentityStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const { envName, appUrls } = props.config;
    const isProd = envName === 'prod';
    if (appUrls.length === 0) throw new Error('IdentityStack needs at least one app URL');

    this.userPool = new cognito.UserPool(this, 'S10Identity', {
      userPoolName: `s10-identity-${envName}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      // Optional now; required for the owner in Phase 3 (02 §3.3).
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: isProd,
      // User accounts must survive stack replacement in every environment.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(this.userPool).acknowledge(
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA is optional during the internal phase; required for the owner in M3.2 (02 §3.3).',
      },
      {
        id: 'AwsSolutions-COG3',
        reason:
          'Threat protection needs the Plus feature plan (per-user cost); revisit before public launch (M4.x).',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'Essentials tier during the internal phase (cost); Plus is reconsidered before public launch (M4.x).',
      },
    );

    this.domain = this.userPool.addDomain('ManagedLogin', {
      // Cognito prefix domain for now; a custom domain (e.g. auth.spen10.com) needs DNS + ACM.
      cognitoDomain: { domainPrefix: `s10-identity-${envName}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.webClient = this.userPool.addClient('MarketingWeb', {
      userPoolClientName: 's10-marketing-web',
      generateSecret: false,
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: appUrls.map((u) => `${u}/api/auth/callback`),
        logoutUrls: appUrls.map((u) => `${u}/signed-out`),
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
    });

    // Managed login (v2) pages need a branding record; Cognito's default styles for now.
    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.webClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const params: Record<string, string> = {
      'cognito-user-pool-id': this.userPool.userPoolId,
      'cognito-client-id': this.webClient.userPoolClientId,
      'cognito-domain': `${this.domain.domainName}.auth.${this.region}.amazoncognito.com`,
      'app-url': appUrls[0]!,
    };
    for (const [name, value] of Object.entries(params)) {
      new ssm.StringParameter(this, `Param-${name}`, {
        parameterName: `${paramPrefix(envName)}/${name}`,
        stringValue: value,
        tier: ssm.ParameterTier.STANDARD,
      });
    }
  }
}
