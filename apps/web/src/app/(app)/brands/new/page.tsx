import type { Metadata } from 'next';
import { can } from '@s10/core/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireOrgActor } from '@/server/org-context';
import { BrandForm } from '../brand-form';

export const metadata: Metadata = { title: 'New brand' };
export const dynamic = 'force-dynamic';

export default async function NewBrandPage() {
  const actor = await requireOrgActor();
  const allowed = can(actor.role, 'brand.create');

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New brand in {actor.org.name}</CardTitle>
          <CardDescription>
            {allowed
              ? 'You can set up its voice right after creating it.'
              : 'Only owners and admins can add brands to this organization.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandForm
            timeZones={Intl.supportedValuesOf('timeZone')}
            orgTimeZone={actor.org.timezone}
            disabled={!allowed}
          />
        </CardContent>
      </Card>
    </div>
  );
}
