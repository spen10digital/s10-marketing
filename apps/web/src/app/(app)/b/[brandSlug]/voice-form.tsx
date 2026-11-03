'use client';

import type { VoiceValues } from '@s10/core/ai/client';
import { useActionState, type Ref } from 'react';
import { saveVoiceAction } from '@/app/(app)/actions';
import { SubmitButton } from '@/components/ui/button';
import { Field, FormMessage, Input, Textarea } from '@/components/ui/form';
import { idle } from '@/server/action-state';

export const EMPTY_VOICE: VoiceValues = {
  audience: '',
  tone: '',
  guidelines: '',
  doList: [],
  dontList: [],
  examplePosts: [],
  ctaDefaults: [],
};

/** Reads the editor's current (possibly unsaved) values, parsed the same way the save action does. */
export function readVoiceForm(form: HTMLFormElement): VoiceValues {
  const data = new FormData(form);
  const text = (key: string) => String(data.get(key) ?? '');
  const lines = (key: string) =>
    text(key)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    audience: text('audience').trim(),
    tone: text('tone').trim(),
    guidelines: text('guidelines').trim(),
    doList: lines('doList'),
    dontList: lines('dontList'),
    ctaDefaults: lines('ctaDefaults'),
    examplePosts: text('examplePosts')
      .split(/\r?\n---\r?\n/)
      .map((b) => b.trim())
      .filter(Boolean),
  };
}

export function VoiceForm({
  brandId,
  brandSlug,
  version,
  values,
  disabled,
  formRef,
}: {
  brandId: string;
  brandSlug: string;
  /** The saved version this editor started from (0 when there is none). */
  version: number;
  values: VoiceValues;
  disabled?: boolean;
  formRef?: Ref<HTMLFormElement>;
}) {
  const [state, action] = useActionState(saveVoiceAction, idle);
  const err = state.fieldErrors ?? {};

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="brandSlug" value={brandSlug} />
      <input type="hidden" name="expectedVersion" value={version} />
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <Field label="Audience" htmlFor="audience" hint="Who the brand talks to." error={err.audience}>
          <Textarea id="audience" name="audience" maxLength={1000} defaultValue={values.audience} />
        </Field>
        <Field
          label="Tone"
          htmlFor="tone"
          hint="A few words, e.g. “playful, nerdy, never snarky”."
          error={err.tone}
        >
          <Input id="tone" name="tone" maxLength={500} defaultValue={values.tone} />
        </Field>
        <Field label="Guidelines" htmlFor="guidelines" error={err.guidelines}>
          <Textarea
            id="guidelines"
            name="guidelines"
            maxLength={4000}
            className="min-h-32"
            defaultValue={values.guidelines}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Do" htmlFor="doList" hint="One per line." error={err.doList}>
            <Textarea id="doList" name="doList" defaultValue={values.doList.join('\n')} />
          </Field>
          <Field label="Don’t" htmlFor="dontList" hint="One per line." error={err.dontList}>
            <Textarea id="dontList" name="dontList" defaultValue={values.dontList.join('\n')} />
          </Field>
        </div>
        <Field label="Calls to action" htmlFor="ctaDefaults" hint="One per line." error={err.ctaDefaults}>
          <Textarea id="ctaDefaults" name="ctaDefaults" defaultValue={values.ctaDefaults.join('\n')} />
        </Field>
        <Field
          label="Example posts"
          htmlFor="examplePosts"
          hint="Separate posts with a line containing only ---"
          error={err.examplePosts}
        >
          <Textarea
            id="examplePosts"
            name="examplePosts"
            className="min-h-40 font-mono text-xs"
            defaultValue={values.examplePosts.join('\n---\n')}
          />
        </Field>
        <div>
          <SubmitButton>Save new version</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
