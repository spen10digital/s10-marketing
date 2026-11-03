import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { AiTask, TokenUsage } from './types';

/** Where AI usage metrics go. Failures here never fail a request. */
export interface AiMetricsSink {
  record(entry: {
    task: AiTask;
    modelId: string;
    status: string;
    usage: TokenUsage;
    costMicros: number;
  }): Promise<void>;
}

/** One namespace for the app; the web role may only write to this namespace (IAM condition). */
export const AI_METRIC_NAMESPACE = 'S10Marketing/AI';

export class CloudWatchAiMetrics implements AiMetricsSink {
  constructor(
    private readonly client: CloudWatchClient,
    private readonly environment: string,
  ) {}

  async record({
    modelId,
    status,
    usage,
    costMicros,
  }: Parameters<AiMetricsSink['record']>[0]): Promise<void> {
    const dimensions = [
      { Name: 'Environment', Value: this.environment },
      { Name: 'Model', Value: modelId },
    ];
    const metric = (name: string, value: number, unit: 'Count' | 'None' = 'Count') => ({
      MetricName: name,
      Dimensions: dimensions,
      Value: value,
      Unit: unit,
    });
    await this.client.send(
      new PutMetricDataCommand({
        Namespace: AI_METRIC_NAMESPACE,
        MetricData: [
          metric('InputTokens', usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens),
          metric('OutputTokens', usage.outputTokens),
          metric('CacheReadTokens', usage.cacheReadTokens),
          metric('CostMicroUsd', costMicros, 'None'),
          metric(status === 'succeeded' ? 'Generations' : 'FailedGenerations', 1),
        ],
      }),
    );
  }
}

export const noopMetrics: AiMetricsSink = { record: async () => {} };
