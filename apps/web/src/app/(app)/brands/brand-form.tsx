'use client';

import { useActionState } from 'react';
import { updateBrandAction } from '@/app/(app)/actions';
import { SubmitButton } from '@/components/ui/button';
import { Field, FormMessage, Input, Textarea } from '@/components/ui/form';
import { TimeZoneSelect } from '@/components/time-zone-select';
import { idle } from '@/server/action-state';

export interface BrandFormValues {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  timezone: string | null;
}

/** Edit a brand's details. The name, website, contact and address belong to the Suite business. */
export function BrandForm({
  brand,
  timeZones,
  orgTimeZone,
  disabled,
}: {
  brand: BrandFormValues;
  timeZones: string[];
  orgTimeZone: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(updateBrandAction, idle);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="brandId" value={brand.id} />
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <Field
          label="Brand name"
          htmlFor="name"
          hint="The name comes from your business in S10/Suite. Change it there."
          error={err.name}
        >
          <Input id="name" name="name" readOnly maxLength={120} defaultValue={brand.name} />
        </Field>
        <Field
          label="URL name"
          htmlFor="slug"
          hint="Changing this changes the brand’s links."
          error={err.slug}
        >
          <Input
            id="slug"
            name="slug"
            maxLength={64}
            defaultValue={brand.slug}
            placeholder="loot-goblin-labs"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </Field>
        <Field label="Description" htmlFor="description" error={err.description}>
          <Textarea
            id="description"
            name="description"
            maxLength={2000}
            defaultValue={brand.description ?? ''}
          />
        </Field>
        <Field label="Website" htmlFor="websiteUrl" error={err.websiteUrl}>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            maxLength={2048}
            defaultValue={brand.websiteUrl ?? ''}
            placeholder="https://"
          />
        </Field>
        <Field label="Time zone" htmlFor="timezone" error={err.timezone}>
          <TimeZoneSelect
            id="timezone"
            name="timezone"
            zones={timeZones}
            defaultValue={brand.timezone ?? ''}
            allowEmpty={`Organization default (${orgTimeZone.replace(/_/g, ' ')})`}
          />
        </Field>
        <div>
          <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
