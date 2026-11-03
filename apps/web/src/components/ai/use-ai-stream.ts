'use client';

import { parsePartialJson } from '@s10/core/ai/client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AiStreamState<T> {
  status: 'idle' | 'streaming' | 'done' | 'error';
  /** Best-effort view of the output while it streams. */
  partial: unknown;
  /** The validated output, once done. */
  output: T | null;
  generationId: string | null;
  error: string | null;
}

const initial = {
  status: 'idle',
  partial: undefined,
  output: null,
  generationId: null,
  error: null,
} as const;

type StreamEvent =
  | { type: 'start'; generationId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; generationId: string; output: unknown }
  | { type: 'error'; code: string; message: string };

/**
 * Runs one `/api/ai/stream` request and exposes its progress. Starting again or unmounting
 * cancels the previous request (the server then stops the model call).
 */
export function useAiStream<T>(brandSlug: string) {
  const [state, setState] = useState<AiStreamState<T>>(initial);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState((s) => (s.status === 'streaming' ? { ...initial } : s));
  }, []);

  const run = useCallback(
    async (request: { action: string; input: unknown }): Promise<T | null> => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState({ ...initial, status: 'streaming' });
      let text = '';
      try {
        const res = await fetch('/api/ai/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ brandSlug, request }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          if (res.status === 401)
            throw new Error('Your session has expired. Reload the page to sign in again.');
          throw new Error(body?.error?.message ?? 'The request failed.');
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === 'start') setState((s) => ({ ...s, generationId: event.generationId }));
            else if (event.type === 'delta') {
              text += event.text;
              const partial = parsePartialJson(text);
              setState((s) => ({ ...s, partial }));
            } else if (event.type === 'done') {
              setState({
                status: 'done',
                partial: event.output,
                output: event.output as T,
                generationId: event.generationId,
                error: null,
              });
              return event.output as T;
            } else {
              throw new Error(event.message);
            }
          }
        }
        throw new Error('The response ended early. Please try again.');
      } catch (err) {
        if (abort.signal.aborted) return null;
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'The request failed.',
        }));
        return null;
      }
    },
    [brandSlug],
  );

  return { ...state, run, cancel };
}
