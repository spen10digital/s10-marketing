import { Aws, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { resourcePrefix, type EnvConfig } from './env-config';

export interface CicdStackProps extends StackProps {
  config: EnvConfig & { githubRepo: string };
}

/**
 * GitHub Actions → AWS through OIDC (no stored keys). The diff role can be used from any
 * ref of the repo; the deploy role only from the protected GitHub environment of the same
 * name (`dev` / `prod`), which requires owner approval (05 §8). `githubRepo` must match the
 * repo part of the token's `sub` claim exactly, including immutable IDs when GitHub uses them.
 */
export class CicdStack extends Stack {
  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);
    const { envName, githubRepo } = props.config;
    const prefix = resourcePrefix(envName);

    const provider = new iam.OidcProviderNative(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const principal = (sub: string) =>
      new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': sub },
      });

    const bootstrapRole = (kind: string) =>
      `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-hnb659fds-${kind}-role-${Aws.ACCOUNT_ID}-${Aws.REGION}`;

    const diffRole = new iam.Role(this, 'GithubDiffRole', {
      roleName: `${prefix}-github-diff`,
      assumedBy: principal(`repo:${githubRepo}:*`),
      maxSessionDuration: Duration.hours(1),
    });
    diffRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [bootstrapRole('lookup')] }),
    );

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: `${prefix}-github-deploy`,
      assumedBy: principal(`repo:${githubRepo}:environment:${envName}`),
      maxSessionDuration: Duration.hours(1),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['lookup', 'deploy', 'file-publishing', 'image-publishing'].map(bootstrapRole),
      }),
    );
  }
}
