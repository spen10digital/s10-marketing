'use client';

import { useActionState } from 'react';
import { saveVoiceAction } from '@/app/(app)/actions';
import { SubmitButton } from '@/components/ui/button';
import { Field, FormMessage, Input, Textarea } from '@/components/ui/form';
import { idle } from '@/server/action-state';

export interface VoiceValues {
  version: number;
  audience: string;
  tone: string;
  guidelines: string;
  doList: string[];
  dontList: string[];
  examplePosts: string[];
  ctaDefaults: string[];
}

export function VoiceForm({
  brandId,
  brandSlug,
  voice,
  disabled,
}: {
  brandId: string;
  brandSlug: string;
  voice: VoiceValues | null;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(saveVoiceAction, idle);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="brandSlug" value={brandSlug} />
      <input type="hidden" name="expectedVersion" value={voice?.version ?? 0} />
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <Field label="Audience" htmlFor="audience" hint="Who the brand talks to." error={err.audience}>
          <Textarea id="audience" name="audience" maxLength={1000} defaultValue={voice?.audience} />
        </Field>
        <Field
          label="Tone"
          htmlFor="tone"
          hint="A few words, e.g. “playful, nerdy, never snarky”."
          error={err.tone}
        >
          <Input id="tone" name="tone" maxLength={500} defaultValue={voice?.tone} />
        </Field>
        <Field label="Guidelines" htmlFor="guidelines" error={err.guidelines}>
          <Textarea
            id="guidelines"
            name="guidelines"
            maxLength={4000}
            className="min-h-32"
            defaultValue={voice?.guidelines}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Do" htmlFor="doList" hint="One per line." error={err.doList}>
            <Textarea id="doList" name="doList" defaultValue={voice?.doList.join('\n')} />
          </Field>
          <Field label="Don’t" htmlFor="dontList" hint="One per line." error={err.dontList}>
            <Textarea id="dontList" name="dontList" defaultValue={voice?.dontList.join('\n')} />
          </Field>
        </div>
        <Field label="Calls to action" htmlFor="ctaDefaults" hint="One per line." error={err.ctaDefaults}>
          <Textarea id="ctaDefaults" name="ctaDefaults" defaultValue={voice?.ctaDefaults.join('\n')} />
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
            defaultValue={voice?.examplePosts.join('\n---\n')}
          />
        </Field>
        <div>
          <SubmitButton>Save new version</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
