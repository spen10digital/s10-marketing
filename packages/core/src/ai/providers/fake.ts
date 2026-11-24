import type { AiProvider, ProviderEvent, ProviderRequest, TokenUsage } from '../types';

/**
 * Deterministic provider for tests and local development without Bedrock. Streams `output` (a
 * value is JSON-encoded) in small chunks and reports fixed usage.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly requests: ProviderRequest[] = [];

  constructor(
    private readonly respond: (request: ProviderRequest) => unknown | Promise<unknown>,
    private readonly options: { usage?: TokenUsage; chunkSize?: number; stopReason?: string } = {},
  ) {}

  async *stream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent> {
    this.requests.push(request);
    const output = await this.respond(request);
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    const size = this.options.chunkSize ?? 16;
    for (let i = 0; i < text.length; i += size) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      yield { type: 'text', text: text.slice(i, i + size) };
    }
    yield { type: 'stop', reason: this.options.stopReason ?? 'end_turn' };
    yield {
      type: 'usage',
      usage: this.options.usage ?? {
        inputTokens: 1000,
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
