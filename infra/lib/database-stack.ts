import { Duration, RemovalPolicy, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { paramPrefix, resourcePrefix, type EnvConfig } from './env-config';

export interface DatabaseStackProps extends StackProps {
  config: EnvConfig;
}

export const DB_NAME = 's10_marketing';

/**
 * Aurora PostgreSQL Serverless v2 reached only through the RDS Data API (ADR 0010, ADR 0015).
 * Aurora must sit in a VPC, so it gets a VPC with isolated subnets only: no internet gateway,
 * no NAT, no inbound rules. Nothing else runs in it.
 *
 * Two secrets: the cluster master user `app_owner` (migrations only) and `app_rw` (the app and
 * workers; its password is applied by scripts/db-migrate.ts). Only `app_rw` is granted to roles.
 */
export class DatabaseStack extends Stack {
  readonly cluster: rds.DatabaseCluster;
  readonly appSecret: secretsmanager.Secret;
  readonly ownerSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    const { envName, dbCapacity } = props.config;
    const prefix = resourcePrefix(envName);
    const isProd = envName === 'prod';

    const vpc = new ec2.Vpc(this, 'DbVpc', {
      vpcName: `${prefix}-db`,
      maxAzs: 2,
      natGateways: 0,
      createInternetGateway: false,
      subnetConfiguration: [{ name: 'db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
      restrictDefaultSecurityGroup: false,
    });
    Validations.of(vpc).acknowledge({
      id: 'AwsSolutions-VPC7',
      reason:
        'Isolated subnets with no internet path and no compute; the cluster is reached only via the Data API, so flow logs would record nothing useful.',
    });

    const securityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Aurora cluster; no inbound rules (Data API only)',
      allowAllOutbound: false,
    });

    // Created up front with retention, instead of the cluster's log-retention helper Lambda.
    const clusterIdentifier = `${prefix}-db`;
    const postgresLogs = new logs.LogGroup(this, 'PostgresLogs', {
      logGroupName: `/aws/rds/cluster/${clusterIdentifier}/postgresql`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.cluster = new rds.DatabaseCluster(this, 'Cluster', {
      clusterIdentifier,
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_13 }),
      credentials: rds.Credentials.fromGeneratedSecret('app_owner', { secretName: `${prefix}/db/app-owner` }),
      defaultDatabaseName: DB_NAME,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
        autoMinorVersionUpgrade: true,
      }),
      serverlessV2MinCapacity: dbCapacity.min,
      serverlessV2MaxCapacity: dbCapacity.max,
      serverlessV2AutoPauseDuration: Duration.minutes(10),
      enableDataApi: true,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroup],
      storageEncrypted: true,
      iamAuthentication: false,
      backup: { retention: Duration.days(isProd ? 14 : 7) },
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
    });
    this.cluster.node.addDependency(postgresLogs);
    this.ownerSecret = this.cluster.secret!;

    this.appSecret = new secretsmanager.Secret(this, 'AppRwSecret', {
      secretName: `${prefix}/db/app-rw`,
      description: 'Credentials for the app_rw database role (RLS enforced). Used by the Data API.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'app_rw', engine: 'postgres', dbname: DB_NAME }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 40,
      },
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // `cluster.secret` is the attachment; the generated secret itself is the `Secret` child.
    for (const secret of [this.cluster.node.findChild('Secret'), this.appSecret]) {
      Validations.of(secret).acknowledge({
        id: 'AwsSolutions-SMG4',
        reason:
          'Rotation Lambdas need network access to the cluster (VPC endpoints or NAT, ruled out by ADR 0010). Rotate manually per the runbook.',
      });
    }
    Validations.of(this.cluster).acknowledge(
      {
        id: 'AwsSolutions-RDS6',
        reason: 'IAM database authentication does not apply: the app uses the Data API with Secrets Manager.',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason:
          'No network listener is reachable (isolated subnets, no inbound rules); the port is irrelevant.',
      },
      { id: 'AwsSolutions-RDS14', reason: 'Backtrack is not available for Aurora PostgreSQL.' },
      ...(isProd
        ? []
        : [{ id: 'AwsSolutions-RDS10', reason: 'Dev can be torn down; prod has deletion protection.' }]),
    );

    // Identifiers for the config loader and the migration runner. ARNs are not secrets.
    const params: Record<string, string> = {
      'db-cluster-arn': this.cluster.clusterArn,
      'db-secret-arn': this.appSecret.secretArn,
      'db-owner-secret-arn': this.ownerSecret.secretArn,
      'db-name': DB_NAME,
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
