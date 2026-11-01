import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { resourcePrefix, type EnvConfig } from './env-config';

export interface ObservabilityStackProps extends StackProps {
  config: EnvConfig;
  opsTopic: sns.ITopic;
}

/**
 * Spend guardrails (06 §7): a monthly cost budget alerting at each threshold, plus Cost
 * Anomaly Detection. Alarms and dashboards for workers are added with their milestones.
 */
export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config, opsTopic } = props;
    const prefix = resourcePrefix(config.envName);

    for (const service of ['budgets.amazonaws.com', 'costalerts.amazonaws.com']) {
      opsTopic.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: `Allow-${service.split('.')[0]}`,
          principals: [new iam.ServicePrincipal(service)],
          actions: ['sns:Publish'],
          resources: [opsTopic.topicArn],
          conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
        }),
      );
    }

    const subscribers: budgets.CfnBudget.SubscriberProperty[] = [
      { subscriptionType: 'SNS', address: opsTopic.topicArn },
      ...(config.alertEmail ? [{ subscriptionType: 'EMAIL', address: config.alertEmail }] : []),
    ];
    const limit = Math.max(...config.budgetThresholdsUsd);

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: `${prefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: limit, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        ...config.budgetThresholdsUsd.map((amount) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: amount,
            thresholdType: 'ABSOLUTE_VALUE',
          },
          subscribers,
        })),
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers,
        },
      ],
    });

    const monitor = new ce.CfnAnomalyMonitor(this, 'CostAnomalyMonitor', {
      monitorName: `${prefix}-services`,
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });
    new ce.CfnAnomalySubscription(this, 'CostAnomalySubscription', {
      subscriptionName: `${prefix}-anomalies`,
      frequency: 'IMMEDIATE',
      monitorArnList: [monitor.attrMonitorArn],
      subscribers: [{ type: 'SNS', address: opsTopic.topicArn }],
      // Alert when an anomaly's impact exceeds $10.
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: ['10'],
        },
      }),
    });
  }
}
