'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { OrgSummary } from '@s10/core/domain';
import { switchOrganizationAction } from '@/app/(app)/actions';
import { Select } from '@/components/ui/form';

export function OrgSwitcher({ orgs, currentOrgId }: { orgs: OrgSummary[]; currentOrgId: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);

  if (orgs.length === 0) {
    return (
      <Link
        href="/orgs/new"
        className="block rounded-md border border-dashed border-border px-3 py-2 text-sm"
      >
        Create an organization
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <form ref={formRef} action={switchOrganizationAction}>
        <label htmlFor="org-switcher" className="sr-only">
          Organization
        </label>
        <Select
          id="org-switcher"
          name="orgId"
          defaultValue={currentOrgId ?? undefined}
          onChange={() => formRef.current?.requestSubmit()}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <noscript>
          <button type="submit" className="mt-1 text-xs underline">
            Switch
          </button>
        </noscript>
      </form>
      <Link href="/orgs/new" className="px-1 text-xs text-muted-foreground hover:underline">
        + New organization
      </Link>
    </div>
  );
}
