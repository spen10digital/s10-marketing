import { AppRail, AppShell, Button, shortName, type RailApp } from '@spen10digital/s10-ui';
import type { TopBarSearchGroup } from '@spen10digital/s10-ui/client';
import type { ReactNode } from 'react';
import type { OrgSummary } from '@s10/core/domain';
import type { SuiteApps } from '@s10/core/suite';
import { AppNav } from './app-nav';
import { AppTopBar } from './app-top-bar';
import { OrgSwitcher } from './org-switcher';

/** "Mail" → "S10/Mail" (naming rule: every app is S10/appname). */
export function fullAppName(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.startsWith('S10/') ? trimmed : `S10/${trimmed}`;
}

/**
 * The rail from the Suite's app registry. A locked app (not in the plan) links to Suite billing.
 * S10/Marketing is always listed, so the rail still works when the Suite cannot be reached.
 */
export function railApps(apps: SuiteApps['apps'], suiteUrl: string, appId: string): RailApp[] {
  const rail: RailApp[] = apps.map((a) => {
    const name = fullAppName(a.display_name);
    return {
      id: a.app_id,
      name,
      short: shortName(name),
      href: a.entitled ? a.url : `${suiteUrl}/billing`,
      locked: !a.entitled,
    };
  });
  if (!rail.some((a) => a.id === appId)) {
    rail.unshift({ id: appId, name: 'S10/Marketing', short: shortName('S10/Marketing'), href: '/dashboard' });
  }
  return rail;
}

/**
 * Every S10 app's frame, from s10-ui: the app rail (the registry-driven app switcher), this
 * app's sidebar with the S10 logo, and the top bar. Pages add their own PageHeader and PageBody.
 */
export function AppFrame({
  appId,
  apps,
  suiteUrl,
  email,
  orgs,
  currentOrgId,
  theme,
  mode,
  searchGroups,
  brandNames,
  children,
}: {
  appId: string;
  apps: SuiteApps['apps'];
  suiteUrl: string;
  email: string;
  orgs: OrgSummary[];
  currentOrgId: string | null;
  theme?: string;
  mode?: 'light' | 'dark' | 'system';
  searchGroups: TopBarSearchGroup[];
  brandNames: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <AppShell
      rail={<AppRail apps={railApps(apps, suiteUrl, appId)} currentAppId={appId} homeHref={suiteUrl} />}
      sidebar={
        <AppNav
          header={orgs.length > 1 ? <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} /> : undefined}
          footer={
            <form action="/api/auth/logout" method="post" className="px-2">
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          }
        />
      }
    >
      <AppTopBar
        email={email}
        theme={theme}
        mode={mode}
        searchGroups={searchGroups}
        brandNames={brandNames}
      />
      {children}
    </AppShell>
  );
}
