import type { Metadata } from 'next';
import Link from 'next/link';
import { withDbContext } from '@s10/core/db';
import { listBrands } from '@s10/core/domain';
import { filterVisibleBrands } from '@s10/core/suite';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { getCognitoSettings } from '@/server/auth/cognito';
import { getOrgContext, requireOrgActor } from '@/server/org-context';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { suiteUrl } = await getCognitoSettings();
  const actor = await requireOrgActor();
  const { visibleBusinessIds } = await getOrgContext();
  const [config, allBrands] = await Promise.all([
    getConfig(),
    getDb().then((db) => withDbContext(db, { userId: actor.userId }, (tx) => listBrands(tx, actor.orgId))),
  ]);
  // Brands are Suite businesses: show only those the Suite lists for this person.
  const brands = filterVisibleBrands(allBrands, visibleBusinessIds);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {actor.org.name} · you are {article(actor.org.role)} {actor.org.role}
          </p>
        </div>
      </header>

      {brands.length === 0 ? (
        <Card>
          <CardHeader className="items-start gap-3 p-8">
            <CardTitle className="text-lg">No businesses yet</CardTitle>
            <CardDescription>
              Each business you add in S10/Suite, with S10/Marketing turned on for it, appears here as a brand
              with its own voice, connected Pages and posts.
            </CardDescription>
            <ButtonLink href={suiteUrl} prefetch={false}>
              Open S10/Suite
            </ButtonLink>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={`/b/${b.slug}`}
                className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Card className="h-full transition hover:border-primary/50">
                  <CardHeader>
                    <CardTitle>{b.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {b.description ?? b.websiteUrl ?? 'No description'}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge>{config.APP_ENV}</Badge>
        Publishing {config.PUBLISHING_ENABLED ? 'enabled' : 'disabled'} · Meta Graph API{' '}
        {config.META_GRAPH_VERSION}
      </p>
    </div>
  );
}

function article(word: string) {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}
