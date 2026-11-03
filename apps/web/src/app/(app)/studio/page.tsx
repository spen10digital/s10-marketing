import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withDbContext } from '@s10/core/db';
import { listBrands } from '@s10/core/domain';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/server/db';
import { requireOrgActor } from '@/server/org-context';

export const metadata: Metadata = { title: 'Studio' };
export const dynamic = 'force-dynamic';

/** The Studio works per brand: go straight there when there is one, otherwise pick. */
export default async function StudioIndexPage() {
  const actor = await requireOrgActor();
  const brands = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
    listBrands(tx, actor.orgId),
  );
  if (brands.length === 1) redirect(`/b/${brands[0]!.slug}/studio`);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a brand on the{' '}
          <Link href="/dashboard" className="underline">
            dashboard
          </Link>{' '}
          first.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {brands.map((b) => (
            <Link key={b.id} href={`/b/${b.slug}/studio`} className="rounded-lg focus-visible:outline-2">
              <Card className="hover:bg-muted">
                <CardHeader>
                  <CardTitle>{b.name}</CardTitle>
                  {b.description ? <CardDescription>{b.description}</CardDescription> : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
