import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import type { Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/app';
import { resolveEnvConfig } from '../lib/env-config';

const synth = (context: Parameters<typeof resolveEnvConfig>[0]) => {
  const built = buildApp({
    config: resolveEnvConfig(context),
    account: '111111111111',
    outdir: mkdtempSync(join(tmpdir(), 'cdk-test-')),
  });
  built.app.synth();
  return built;
};

const dev = synth({
  env: 'dev',
  githubRepo: 'owner/s10-marketing',
  alertEmail: 'ops@example.com',
  vercelTeam: 'spen10',
});
const prod = synth({ env: 'prod', vercelTeam: 'spen10' });
const stacks = (b: ReturnType<typeof synth>): Stack[] =>
  [b.core, b.observability, b.database, b.identity, b.vercel, b.cicd].filter(
    (s): s is NonNullable<typeof s> => !!s,
  );

describe.each([
  ['dev', dev],
  ['prod', prod],
])('%s environment', (_name, built) => {
  it.each(stacks(built).map((s) => [s.stackName, s] as const))(
    '%s has no cdk-nag or guardrail errors',
    (_n, stack) => {
      const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
      expect(errors.map((e) => `${e.id}: ${String(e.entry.data)}`)).toEqual([]);
    },
  );

  it('never creates NAT gateways, RDS Proxy, internet gateways, or VPCs outside the Database stack', () => {
    for (const stack of stacks(built)) {
      const t = Template.fromStack(stack);
      t.resourceCountIs('AWS::EC2::NatGateway', 0);
      t.resourceCountIs('AWS::RDS::DBProxy', 0);
      t.resourceCountIs('AWS::EC2::InternetGateway', 0);
      // Aurora requires a VPC; it is the only one, with isolated subnets (ADR 0015).
      t.resourceCountIs('AWS::EC2::VPC', stack === built.database ? 1 : 0);
    }
  });

  it('gives every log group a retention period', () => {
    for (const stack of stacks(built)) {
      const groups = Template.fromStack(stack).findResources('AWS::Logs::LogGroup');
      for (const g of Object.values(groups)) expect(g.Properties?.RetentionInDays).toBeGreaterThan(0);
    }
  });

  it('never uses wildcard IAM actions', () => {
    for (const stack of stacks(built)) {
      const policies = Template.fromStack(stack).findResources('AWS::IAM::Policy');
      for (const p of Object.values(policies)) {
        for (const s of p.Properties.PolicyDocument.Statement as { Action: string | string[] }[]) {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          for (const a of actions) expect(a).not.toMatch(/(^\*$|:\*$)/);
        }
      }
    }
  });
});

describe('CoreStack', () => {
  const t = Template.fromStack(dev.core);

  it('rotates the token KMS key and grants no Decrypt in the key policy', () => {
    t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    const key = Object.values(t.findResources('AWS::KMS::Key'))[0]!;
    const statements = key.Properties.KeyPolicy.Statement as { Principal: unknown; Action: unknown }[];
    // Only the account root statement (IAM delegation); role grants come in M1.4.
    expect(statements).toHaveLength(1);
  });

  it('keeps the media bucket private, encrypted, versioned and TLS-only', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      }),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: 'Enabled' },
    });
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      }),
    });
  });

  it('encrypts every queue and gives work queues a DLQ', () => {
    const queues = t.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues)).toHaveLength(4);
    for (const q of Object.values(queues)) expect(q.Properties.SqsManagedSseEnabled).toBe(true);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 's10-marketing-dev-publish-queue',
      VisibilityTimeout: 360,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
  });

  it('publishes config to Parameter Store with kill switches off', () => {
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/s10-marketing/dev/publishing-enabled',
      Value: 'false',
    });
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/s10-marketing/dev/meta-graph-version',
      Value: 'v26.0',
    });
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/s10-marketing/dev/ai-model-generate',
      Value: 'us.anthropic.claude-sonnet-5-5',
    });
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/s10-marketing/dev/ai-model-fast',
      Value: 'us.anthropic.claude-haiku-5-5',
    });
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/s10-marketing/dev/ai-default-monthly-budget-usd',
      Value: '10',
    });
  });

  it('subscribes the alert email when provided', () => {
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
    Template.fromStack(prod.core).resourceCountIs('AWS::SNS::Subscription', 0);
  });
});

describe('ObservabilityStack', () => {
  it('alerts at $25, $75 and $150 of actual spend', () => {
    const t = Template.fromStack(dev.observability);
    const budget = Object.values(t.findResources('AWS::Budgets::Budget'))[0]!;
    const thresholds = (
      budget.Properties.NotificationsWithSubscribers as {
        Notification: { NotificationType: string; Threshold: number };
      }[]
    )
      .filter((n) => n.Notification.NotificationType === 'ACTUAL')
      .map((n) => n.Notification.Threshold);
    expect(thresholds).toEqual([25, 75, 150]);
    t.resourceCountIs('AWS::CE::AnomalyMonitor', 1);
  });
});

describe('VercelAccessStack', () => {
  const t = Template.fromStack(dev.vercel!);

  it('is only created when the Vercel team slug is configured', () => {
    expect(dev.vercel).toBeDefined();
    expect(prod.vercel).toBeDefined();
    expect(synth({ env: 'dev' }).vercel).toBeUndefined();
  });

  it('trusts only the team issuer, the project, and this account’s Vercel environments', () => {
    t.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://oidc.vercel.com/spen10',
      ClientIdList: ['https://vercel.com/spen10'],
    });
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 's10-marketing-dev-web-runtime',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: { 'oidc.vercel.com/spen10:aud': 'https://vercel.com/spen10' },
              'ForAnyValue:StringEquals': {
                'oidc.vercel.com/spen10:sub': [
                  'owner:spen10:project:s10-marketing:environment:preview',
                  'owner:spen10:project:s10-marketing:environment:development',
                ],
              },
            },
          }),
        ],
      },
    });
    Template.fromStack(prod.vercel!).hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: Match.objectLike({
              'ForAnyValue:StringEquals': {
                'oidc.vercel.com/spen10:sub': ['owner:spen10:project:s10-marketing:environment:production'],
              },
            }),
          }),
        ],
      },
    });
  });

  it('lets the web role read only its own environment’s parameters', () => {
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
            Resource: Match.arrayWith([
              Match.objectLike({
                'Fn::Join': Match.arrayWith([Match.arrayWith([':parameter/s10-marketing/dev/*'])]),
              }),
            ]),
          }),
        ]),
      },
    });
  });

  it('gives the web role the Data API on its cluster with the app_rw secret only', () => {
    const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as { Sid?: string; Action: unknown; Resource: unknown }[],
    );
    const dataApi = statements.find((s) => s.Sid === 'DataApi')!;
    expect(JSON.stringify(dataApi.Resource)).toContain(':cluster:');
    const secret = statements.find((s) => s.Sid === 'DataApiAppRwSecret')!;
    expect(secret.Action).toBe('secretsmanager:GetSecretValue');
    expect(JSON.stringify(secret.Resource)).toContain('AppRwSecret');
    expect(JSON.stringify(statements)).not.toMatch(/ClusterSecret|app-owner/);
  });

  it('lets the web role invoke only the configured Claude models, through their inference profiles', () => {
    const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap(
      (p) =>
        p.Properties.PolicyDocument.Statement as {
          Sid?: string;
          Action: unknown;
          Resource: unknown;
          Condition?: unknown;
        }[],
    );
    const bedrock = statements.filter((s) => JSON.stringify(s.Action).includes('bedrock:'));
    expect(bedrock.map((s) => s.Sid)).toEqual(['BedrockInferenceProfiles', 'BedrockModelsViaProfiles']);
    for (const s of bedrock) {
      expect(s.Action).toEqual(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']);
    }
    const profiles = JSON.stringify(bedrock[0]!.Resource);
    expect(profiles).toContain('inference-profile/us.anthropic.claude-sonnet-5-5');
    expect(profiles).toContain('inference-profile/us.anthropic.claude-haiku-5-5');
    const models = JSON.stringify(bedrock[1]!.Resource);
    expect(models).toContain('foundation-model/anthropic.claude-sonnet-5-5');
    expect(models).not.toContain('foundation-model/*');
    expect(models).not.toContain('foundation-model/us.');
    expect(JSON.stringify(bedrock[1]!.Condition)).toContain('bedrock:InferenceProfileArn');
  });

  it('lets the web role write metrics only to the AI namespace', () => {
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AiMetrics',
            Action: 'cloudwatch:PutMetricData',
            Condition: { StringEquals: { 'cloudwatch:namespace': 'S10Marketing/AI' } },
          }),
        ]),
      },
    });
  });
});

describe('DatabaseStack', () => {
  const t = Template.fromStack(dev.database);

  it('is Aurora PostgreSQL Serverless v2 that can pause, with the Data API on and storage encrypted', () => {
    t.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      EnableHttpEndpoint: true,
      StorageEncrypted: true,
      ServerlessV2ScalingConfiguration: { MinCapacity: 0, MaxCapacity: 4, SecondsUntilAutoPause: 600 },
      MasterUsername: 'app_owner',
    });
    t.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.serverless',
      PubliclyAccessible: false,
    });
  });

  it('protects prod from deletion', () => {
    t.hasResourceProperties('AWS::RDS::DBCluster', { DeletionProtection: false });
    Template.fromStack(prod.database).hasResourceProperties('AWS::RDS::DBCluster', {
      DeletionProtection: true,
    });
  });

  it('uses isolated subnets and a security group with no inbound rules', () => {
    t.resourceCountIs('AWS::EC2::InternetGateway', 0);
    for (const subnet of Object.values(t.findResources('AWS::EC2::Subnet'))) {
      expect(subnet.Properties.MapPublicIpOnLaunch).toBe(false);
    }
    t.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
    for (const sg of Object.values(t.findResources('AWS::EC2::SecurityGroup'))) {
      expect(sg.Properties.SecurityGroupIngress ?? []).toEqual([]);
    }
  });

  it('creates a separate app_rw secret and publishes Data API identifiers', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 's10-marketing-dev/db/app-rw',
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: Match.stringLikeRegexp('"username":"app_rw"'),
      }),
    });
    for (const name of ['db-cluster-arn', 'db-secret-arn', 'db-owner-secret-arn', 'db-name']) {
      t.hasResourceProperties('AWS::SSM::Parameter', { Name: `/s10-marketing/dev/${name}` });
    }
  });
});

describe('IdentityStack', () => {
  const t = Template.fromStack(dev.identity!);

  it('is only created when app URLs are configured', () => {
    expect(dev.identity).toBeDefined();
    expect(prod.identity).toBeUndefined();
    expect(synth({ env: 'prod', appUrls: 'https://marketing.example.com' }).identity).toBeDefined();
  });

  it('is the s10-identity pool on Essentials with optional TOTP MFA, retained on delete', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 's10-identity-dev',
      UserPoolTier: 'ESSENTIALS',
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
    });
    t.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });

  it('has a public PKCE client limited to the code flow and the configured URLs', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['openid', 'email', 'profile'],
      CallbackURLs: [
        'https://s10-marketing-git-develop-spen-10-digital.vercel.app/api/auth/callback',
        'http://localhost:3000/api/auth/callback',
      ],
      LogoutURLs: [
        'https://s10-marketing-git-develop-spen-10-digital.vercel.app/signed-out',
        'http://localhost:3000/signed-out',
      ],
      SupportedIdentityProviders: ['COGNITO'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
    });
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 's10-identity-dev',
      ManagedLoginVersion: 2,
    });
  });
});

describe('CicdStack', () => {
  it('is only created when a GitHub repo is configured', () => {
    expect(dev.cicd).toBeDefined();
    expect(prod.cicd).toBeUndefined();
  });

  it('restricts the deploy role to the protected GitHub environment', () => {
    Template.fromStack(dev.cicd!).hasResourceProperties('AWS::IAM::Role', {
      RoleName: 's10-marketing-dev-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': 'repo:owner/s10-marketing:environment:dev',
              },
            },
          }),
        ],
      },
    });
  });
});

describe('resolveEnvConfig', () => {
  it('rejects unknown environments and malformed repos', () => {
    expect(() => resolveEnvConfig({ env: 'staging' })).toThrow();
    expect(() => resolveEnvConfig({ env: 'prod', appUrls: 'http://example.com' })).toThrow();
    expect(() => resolveEnvConfig({ env: 'prod', appUrls: 'https://example.com/path' })).toThrow();
    expect(() => resolveEnvConfig({ env: 'dev', githubRepo: 'not a repo' })).toThrow();
    expect(() => resolveEnvConfig({ env: 'dev', vercelTeam: 'Not A Slug' })).toThrow();
  });

  it('accepts GitHub immutable OIDC subjects and trusts them exactly', () => {
    const built = synth({ env: 'dev', githubRepo: 'owner@111/s10-marketing@222' });
    Template.fromStack(built.cicd!).hasResourceProperties('AWS::IAM::Role', {
      RoleName: 's10-marketing-dev-github-diff',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: { 'token.actions.githubusercontent.com:sub': 'repo:owner@111/s10-marketing@222:*' },
            }),
          }),
        ],
      },
    });
  });
});
