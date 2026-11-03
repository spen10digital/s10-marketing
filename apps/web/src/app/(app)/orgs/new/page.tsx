import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getOrgContext } from '@/server/org-context';
import { CreateOrganizationForm } from './create-organization-form';

export const metadata: Metadata = { title: 'New organization' };
export const dynamic = 'force-dynamic';

export default async function NewOrganizationPage() {
  const { orgs } = await getOrgContext();
  const first = orgs.length === 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {first ? 'Welcome! Create your organization' : 'New organization'}
          </CardTitle>
          <CardDescription>
            An organization is a separate workspace with its own brands, connected Pages, posts and (later)
            billing. Keep separate businesses in separate organizations. You’ll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm timeZones={Intl.supportedValuesOf('timeZone')} />
        </CardContent>
      </Card>
    </div>
  );
}
