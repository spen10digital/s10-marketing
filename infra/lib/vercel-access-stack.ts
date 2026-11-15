import { Aws, Duration, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { paramPrefix, resourcePrefix, US_INFERENCE_REGIONS, type EnvConfig } from './env-config';

export interface VercelAccessStackProps extends StackProps {
  config: EnvConfig & { vercelTeam: string };
  /** Data API access as app_rw (RLS enforced); never the app_owner secret. */
  database?: { clusterArn: string; appSecretArn: string };
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

    this.grantBedrock([props.config.ai.generateModel, props.config.ai.fastModel]);

    // AI token/cost metrics (M1.3). PutMetricData has no resource ARNs; the namespace condition
    // is the only way to scope it.
    this.webRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AiMetrics',
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'S10Marketing/AI' } },
      }),
    );
    Validations.of(this.webRole).acknowledge({
      id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]',
      reason:
        'cloudwatch:PutMetricData does not support resource ARNs; it is limited to the S10Marketing/AI namespace by condition.',
    });

    if (props.database) {
      this.webRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'DataApi',
          actions: [
            'rds-data:ExecuteStatement',
            'rds-data:BatchExecuteStatement',
            'rds-data:BeginTransaction',
            'rds-data:CommitTransaction',
            'rds-data:RollbackTransaction',
          ],
          resources: [props.database.clusterArn],
        }),
      );
      this.webRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'DataApiAppRwSecret',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [props.database.appSecretArn],
        }),
      );
    }
  }

  /**
   * Bedrock Converse/ConverseStream for exactly the configured models (ADR 0006): the US
   * inference profiles in this account, and the foundation models behind them only when called
   * through those profiles. The model never gets tools, so no other Bedrock action is needed.
   */
  private grantBedrock(profileIds: string[]) {
    const actions = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];
    const profileArns = profileIds.map(
      (id) => `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/${id}`,
    );
    this.webRole.addToPolicy(
      new iam.PolicyStatement({ sid: 'BedrockInferenceProfiles', actions, resources: profileArns }),
    );
    this.webRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelsViaProfiles',
        actions,
        resources: profileIds.flatMap((id) =>
          US_INFERENCE_REGIONS.map(
            (region) => `arn:${Aws.PARTITION}:bedrock:${region}::foundation-model/${id.replace(/^us\./, '')}`,
          ),
        ),
        conditions: { StringEquals: { 'bedrock:InferenceProfileArn': profileArns } },
      }),
    );
  }
}
