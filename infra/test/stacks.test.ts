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
  [b.core, b.observability, b.vercel, b.cicd].filter((s): s is NonNullable<typeof s> => !!s);

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

  it('never creates NAT gateways, RDS Proxy or VPCs', () => {
    for (const stack of stacks(built)) {
      const t = Template.fromStack(stack);
      t.resourceCountIs('AWS::EC2::NatGateway', 0);
      t.resourceCountIs('AWS::RDS::DBProxy', 0);
      t.resourceCountIs('AWS::EC2::VPC', 0);
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
        Statement: [
          Match.objectLike({
            Action: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
            Resource: Match.arrayWith([
              Match.objectLike({
                'Fn::Join': Match.arrayWith([Match.arrayWith([':parameter/s10-marketing/dev/*'])]),
              }),
            ]),
          }),
        ],
      },
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
    expect(() => resolveEnvConfig({ env: 'dev', githubRepo: 'not a repo' })).toThrow();
    expect(() => resolveEnvConfig({ env: 'dev', vercelTeam: 'Not A Slug' })).toThrow();
  });
});
