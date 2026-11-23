import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { withDbContext } from '@s10/core/db';
import { listBrands } from '@s10/core/domain';
import { filterVisibleBrands, SuiteUnavailableError, type SuiteApps } from '@s10/core/suite';
import { AppFrame } from '@/components/app-shell/app-frame';
import { readPrefs } from '@/lib/theme';
import { getCognitoSettings } from '@/server/auth/cognito';
import { getDb } from '@/server/db';
import { getOrgContext } from '@/server/org-context';
import { roleLabel } from '@/components/app-shell/workspace-nav';
import { getSuiteClient } from '@/server/suite';

export const dynamic = 'force-dynamic';

/** Everything under (app) requires a signed-in user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [ctx, settings] = await Promise.all([getOrgContext(), getCognitoSettings()]);
  const { orgs, current, email, session, visibleBusinessIds } = ctx;

  // The rail and search are display only (they decide nothing), so they degrade quietly.
  let apps: SuiteApps['apps'] = [];
  if (ctx.suite === 'ok' && current?.suiteAccountId) {
    try {
      const client = await getSuiteClient();
      apps =
        (
          await client.apps(
            { accessToken: session.accessToken, sub: session.subject },
            current.suiteAccountId,
          )
        )?.apps ?? [];
    } catch (err) {
      if (!(err instanceof SuiteUnavailableError)) throw err;
    }
  }
  const brands = current
    ? filterVisibleBrands(
        await withDbContext(await getDb(), { userId: session.userId }, (tx) => listBrands(tx, current.id)),
        visibleBusinessIds,
      )
    : [];

  // In an app, search covers only this app's own pages.
  const searchGroups = [
    {
      heading: 'S10/Marketing',
      links: [
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Studio', href: '/studio' },
      ],
    },
    ...(brands.length
      ? [
          {
            heading: 'Brands',
            links: brands.flatMap((b) => [
              { label: b.name, href: `/b/${b.slug}`, hint: 'Brand' },
              { label: `${b.name} Studio`, href: `/b/${b.slug}/studio`, hint: 'Studio' },
            ]),
          },
        ]
      : []),
  ];

  const look = readPrefs((await cookies()).get(settings.names.prefs)?.value);
  return (
    <AppFrame
      appId={settings.appId}
      apps={apps}
      suiteUrl={settings.suiteUrl}
      email={email ?? ''}
      orgs={orgs}
      currentOrgId={current?.id ?? null}
      theme={look?.theme}
      mode={look?.mode}
      searchGroups={searchGroups}
      brandNames={Object.fromEntries(brands.map((b) => [b.slug, b.name]))}
      brands={brands.map((b) => ({ slug: b.slug, name: b.name }))}
      roleLabel={current ? roleLabel(current.role) : ''}
    >
      {children}
    </AppFrame>
  );
}
