import { AppError } from '@s10/core/errors';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

/** What a form's server action reports back to `useActionState`. */
export interface ActionState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export const idle: ActionState = { status: 'idle' };

/** Maps validation and domain errors to form feedback; anything else is a generic failure. */
export function toActionState(err: unknown): ActionState {
  unstable_rethrow(err); // redirect()/notFound() must propagate
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = String(issue.path[0] ?? 'form');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }
  if (err instanceof AppError && err.code !== 'INTERNAL' && err.code !== 'CONFIG_INVALID') {
    return { status: 'error', message: err.message };
  }
  console.error('server action failed', err instanceof Error ? err.name : 'unknown');
  return { status: 'error', message: 'Something went wrong. Please try again.' };
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

/** One item per line; blank lines dropped. */
export function formLines(form: FormData, key: string): string[] {
  return formString(form, key)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Blocks separated by a line containing only `---`. */
export function formBlocks(form: FormData, key: string): string[] {
  return formString(form, key)
    .split(/\r?\n---\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}
