import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { AppError } from '../../errors/app-error';
import type { AiProvider, PromptBlock, ProviderEvent, ProviderRequest } from '../types';

/**
 * Claude on Amazon Bedrock through ConverseStream (ADR 0006). Model IDs are `us.` cross-Region
 * inference profiles. No `toolConfig` is ever sent: the model cannot act, only write text.
 */
export class BedrockConverseProvider implements AiProvider {
  readonly name = 'bedrock';

  constructor(private readonly client: BedrockRuntimeClient) {}

  async *stream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    let response;
    try {
      response = await this.client.send(
        new ConverseStreamCommand({
          modelId: request.modelId,
          system: blocks(request.system) as SystemContentBlock[],
          messages: [{ role: 'user', content: blocks(request.user) as ContentBlock[] }],
          inferenceConfig: { maxTokens: request.maxTokens },
          outputConfig: {
            effort: request.effort,
            textFormat: {
              type: 'json_schema',
              structure: {
                jsonSchema: {
                  name: request.jsonSchema.name,
                  schema: JSON.stringify(request.jsonSchema.schema),
                },
              },
            },
          },
        }),
        { abortSignal: signal },
      );
    } catch (err) {
      throw bedrockError(err);
    }

    try {
      for await (const event of response.stream ?? []) {
        const text = event.contentBlockDelta?.delta?.text;
        if (text) yield { type: 'text', text };
        if (event.messageStop) yield { type: 'stop', reason: event.messageStop.stopReason ?? 'unknown' };
        const usage = event.metadata?.usage;
        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cacheReadInputTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteInputTokens ?? 0,
            },
          };
        }
        const failure =
          event.internalServerException ??
          event.modelStreamErrorException ??
          event.serviceUnavailableException ??
          event.throttlingException ??
          event.validationException;
        if (failure) throw bedrockError(failure);
      }
    } catch (err) {
      throw bedrockError(err);
    }
  }
}

/** Text blocks, each followed by a cache point when asked for. */
function blocks(parts: PromptBlock[]): (SystemContentBlock | ContentBlock)[] {
  return parts.flatMap((p) =>
    p.cache ? [{ text: p.text }, { cachePoint: { type: 'default' as const } }] : [{ text: p.text }],
  );
}

/** Maps Bedrock failures to safe user-facing errors; the upstream message is never shown. */
export function bedrockError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const name = (err as { name?: string })?.name ?? 'Error';
  if (name === 'AbortError') return new AppError('BAD_REQUEST', 'The request was canceled.', { cause: err });
  if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException') {
    return new AppError('RATE_LIMITED', 'The AI service is busy. Please try again in a minute.', {
      cause: err,
    });
  }
  if (name === 'AccessDeniedException' || name === 'ResourceNotFoundException') {
    return new AppError('UPSTREAM_UNAVAILABLE', 'AI isn’t available in this environment yet.', {
      cause: err,
    });
  }
  return new AppError('UPSTREAM_UNAVAILABLE', 'The AI service had a problem. Please try again.', {
    cause: err,
  });
}
