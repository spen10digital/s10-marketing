import type { Metadata } from 'next';
import Link from 'next/link';
import { withDbContext } from '@s10/core/db';
import { listBrands } from '@s10/core/domain';
import { brandCardSummaries, filterVisibleBrands } from '@s10/core/suite';
import { PageBody, PageHeader } from '@spen10digital/s10-ui';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { getCognitoSettings } from '@/server/auth/cognito';
import { getOrgContext, requireOrgActor } from '@/server/org-context';
import { getSuiteClient } from '@/server/suite';

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
  // The line under each name comes from the Suite business profile; if the Suite cannot be asked the
  // cards fall back to what Marketing holds and the page still renders.
  const client = await getSuiteClient();
  const who = { accessToken: actor.session.accessToken, sub: actor.session.subject };
  const summaries = await brandCardSummaries(brands, (id) => client.business(who, id));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${actor.org.name} · you are ${article(actor.org.role)} ${actor.org.role}`}
      />
      <PageBody>
        {brands.length === 0 ? (
          <Card>
            <CardHeader className="items-start gap-3 p-8">
              <CardTitle className="text-lg">No businesses yet</CardTitle>
              <CardDescription>
                Each business you add in S10/Suite, with S10/Marketing turned on for it, appears here as a
                brand with its own voice, connected Pages and posts.
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
                  className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Card className="h-full transition hover:border-accent">
                    <CardHeader>
                      <CardTitle>{b.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {summaries.get(b.id)?.summary ?? 'No description yet. Add details in S10/Suite.'}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-center gap-2 text-xs text-muted">
          <Badge>{config.APP_ENV}</Badge>
          Publishing {config.PUBLISHING_ENABLED ? 'enabled' : 'disabled'} · Meta Graph API{' '}
          {config.META_GRAPH_VERSION}
        </p>
      </PageBody>
    </>
  );
}

function article(word: string) {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}
