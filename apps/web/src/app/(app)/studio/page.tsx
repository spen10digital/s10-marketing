import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withDbContext } from '@s10/core/db';
import { listBrands } from '@s10/core/domain';
import { filterVisibleBrands } from '@s10/core/suite';
import { PageBody, PageHeader } from '@spen10digital/s10-ui';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/server/db';
import { getOrgContext, requireOrgActor } from '@/server/org-context';

export const metadata: Metadata = { title: 'Studio' };
export const dynamic = 'force-dynamic';

/** The Studio works per brand: go straight there when there is one, otherwise pick. */
export default async function StudioIndexPage() {
  const actor = await requireOrgActor();
  const { visibleBusinessIds } = await getOrgContext();
  const brands = filterVisibleBrands(
    await withDbContext(await getDb(), { userId: actor.userId }, (tx) => listBrands(tx, actor.orgId)),
    visibleBusinessIds,
  );
  if (brands.length === 1) redirect(`/b/${brands[0]!.slug}/studio`);

  return (
    <>
      <PageHeader title="Studio" description="Write on-brand drafts with AI, one brand at a time." />
      <PageBody>
        {brands.length === 0 ? (
          <p className="text-sm text-muted">
            Add a business in S10/Suite and turn S10/Marketing on for it. It shows up on the{' '}
            <Link href="/dashboard" className="underline">
              dashboard
            </Link>{' '}
            as a brand.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {brands.map((b) => (
              <Link key={b.id} href={`/b/${b.slug}/studio`} className="rounded-lg focus-visible:outline-2">
                <Card className="hover:bg-surface-sunken">
                  <CardHeader>
                    <CardTitle>{b.name}</CardTitle>
                    {b.description ? <CardDescription>{b.description}</CardDescription> : null}
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
