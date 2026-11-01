import { Aws, Duration, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { paramPrefix, resourcePrefix, type EnvConfig } from './env-config';

export interface VercelAccessStackProps extends StackProps {
  config: EnvConfig & { vercelTeam: string };
}

/**
 * Lets the Vercel-hosted web app call AWS without access keys (ADR 0012): Vercel issues an
 * OIDC token per function invocation (team issuer mode), which AWS STS exchanges for the
 * web runtime role. The role grows per milestone (Data API, Bedrock, SQS, KMS Encrypt…).
 *
 * Environment mapping: the dev account trusts Vercel `preview` + `development`; the prod
 * account trusts `production` only.
 */
export class VercelAccessStack extends Stack {
  readonly webRole: iam.Role;

  constructor(scope: Construct, id: string, props: VercelAccessStackProps) {
    super(scope, id, props);
    const { envName, vercelTeam, vercelProject } = props.config;
    const prefix = resourcePrefix(envName);
    const paramPath = paramPrefix(envName);
    const issuerHost = `oidc.vercel.com/${vercelTeam}`;

    const provider = new iam.OidcProviderNative(this, 'VercelOidc', {
      url: `https://${issuerHost}`,
      clientIds: [`https://vercel.com/${vercelTeam}`],
    });

    const vercelEnvs = envName === 'prod' ? ['production'] : ['preview', 'development'];
    this.webRole = new iam.Role(this, 'WebRuntimeRole', {
      roleName: `${prefix}-web-runtime`,
      description: 'Assumed by the S10/Marketing web app on Vercel via OIDC',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: { [`${issuerHost}:aud`]: `https://vercel.com/${vercelTeam}` },
        'ForAnyValue:StringEquals': {
          [`${issuerHost}:sub`]: vercelEnvs.map(
            (env) => `owner:${vercelTeam}:project:${vercelProject}:environment:${env}`,
          ),
        },
      }),
    });
    this.webRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAppConfig',
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter${paramPath}`,
          `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter${paramPath}/*`,
        ],
      }),
    );
    Validations.of(this.webRole).acknowledge({
      id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:ssm:<AWS::Region>:<AWS::AccountId>:parameter${paramPath}/*]`,
      reason: 'Read-only access limited to this environment’s Parameter Store path.',
    });
  }
}
