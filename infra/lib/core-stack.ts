import { Duration, RemovalPolicy, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { paramPrefix, resourcePrefix, type EnvConfig } from './env-config';

export interface CoreStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * Networkless core (02 §12): KMS key for social tokens, private media bucket, SQS queues
 * with DLQs and the ops-alerts topic. Nothing here runs in a VPC.
 */
export class CoreStack extends Stack {
  readonly tokenKey: kms.Key;
  readonly mediaBucket: s3.Bucket;
  readonly publishQueue: sqs.Queue;
  readonly publishDlq: sqs.Queue;
  readonly ingestQueue: sqs.Queue;
  readonly ingestDlq: sqs.Queue;
  readonly opsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);
    const { envName } = props.config;
    const prefix = resourcePrefix(envName);
    const retain = envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Social tokens: Encrypt (web role) / Decrypt (worker role) are granted per role with
    // the {org_id, connection_id} encryption context in M1.4; the key policy grants nobody.
    this.tokenKey = new kms.Key(this, 'TokenKey', {
      alias: `alias/${prefix}-social-tokens`,
      description: 'Encrypts social platform tokens (CredentialVault)',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
    });

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
      removalPolicy: retain,
      autoDeleteObjects: false,
    });
    Validations.of(this.mediaBucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason:
        'Server access logs add a second bucket and cost; object-level auditing is planned via CloudTrail data events in M3.2.',
    });

    const queue = (name: string, visibility: Duration) => {
      const dlq = new sqs.Queue(this, `${name}Dlq`, {
        queueName: `${prefix}-${kebab(name)}-dlq`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        retentionPeriod: Duration.days(14),
      });
      const main = new sqs.Queue(this, name, {
        queueName: `${prefix}-${kebab(name)}`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        // ≥ 6× the worker timeout (05 §10); workers are capped at 60 s.
        visibilityTimeout: visibility,
        retentionPeriod: Duration.days(4),
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });
      return { main, dlq };
    };
    ({ main: this.publishQueue, dlq: this.publishDlq } = queue('PublishQueue', Duration.minutes(6)));
    ({ main: this.ingestQueue, dlq: this.ingestDlq } = queue('IngestQueue', Duration.minutes(6)));
    for (const dlq of [this.publishDlq, this.ingestDlq]) {
      Validations.of(dlq).acknowledge({
        id: 'AwsSolutions-SQS3',
        reason: 'This queue is itself a dead-letter queue.',
      });
    }

    this.opsTopic = new sns.Topic(this, 'OpsAlerts', {
      topicName: `${prefix}-ops-alerts`,
      displayName: 'S10/Marketing ops alerts',
      enforceSSL: true,
    });
    Validations.of(this.opsTopic).acknowledge({
      id: 'AwsSolutions-SNS2',
      reason:
        'Alarm/budget notifications carry no sensitive data, and the AWS-managed SNS key cannot be used by CloudWatch alarms; a dedicated CMK would add cost.',
    });
    if (props.config.alertEmail) {
      this.opsTopic.addSubscription(new subs.EmailSubscription(props.config.alertEmail));
    }

    // Non-secret identifiers for the config loader (05 §5). ARNs and URLs are not secrets.
    const params: Record<string, string> = {
      'token-kms-key-arn': this.tokenKey.keyArn,
      'media-bucket': this.mediaBucket.bucketName,
      'publish-queue-url': this.publishQueue.queueUrl,
      'ingest-queue-url': this.ingestQueue.queueUrl,
      'ops-alert-topic-arn': this.opsTopic.topicArn,
      'meta-graph-version': 'v26.0',
      // Kill switches start off; turning them on is a deliberate owner action.
      'publishing-enabled': 'false',
      'automation-enabled': 'false',
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

function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
