'use client';

import { useActionState, useEffect, useState } from 'react';
import { createOrganizationAction } from '@/app/(app)/actions';
import { SubmitButton } from '@/components/ui/button';
import { Field, FormMessage, Input } from '@/components/ui/form';
import { TimeZoneSelect } from '@/components/time-zone-select';
import { idle } from '@/server/action-state';

export function CreateOrganizationForm({ timeZones }: { timeZones: string[] }) {
  const [state, action] = useActionState(createOrganizationAction, idle);
  const [zone, setZone] = useState('America/Los_Angeles');
  // Default to the browser's zone once mounted (the server can't know it).
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZones.includes(local)) setZone(local);
  }, [timeZones]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />
      <Field label="Organization name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" required maxLength={120} autoFocus placeholder="e.g. S10" />
      </Field>
      <Field
        label="Time zone"
        htmlFor="timezone"
        hint="Default for brands that don't set their own."
        error={state.fieldErrors?.timezone}
      >
        <TimeZoneSelect
          id="timezone"
          name="timezone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          zones={timeZones}
        />
      </Field>
      <div>
        <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
      </div>
    </form>
  );
}
