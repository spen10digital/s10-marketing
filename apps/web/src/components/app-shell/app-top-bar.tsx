'use client';

import { TopBar, type TopBarSearchGroup } from '@spen10digital/s10-ui/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { savePreferencesAction } from '@/app/(app)/actions';
import { crumbsFor } from './nav';

/**
 * The shared top bar: breadcrumbs, search (only this app's pages) and the account menu with
 * theme and light/dark. A choice is saved in the Suite so every S10 app follows it.
 */
export function AppTopBar({
  email,
  theme,
  mode,
  searchGroups,
  brandNames,
}: {
  email: string;
  theme?: string;
  mode?: 'light' | 'dark' | 'system';
  searchGroups: TopBarSearchGroup[];
  /** URL name to display name, for breadcrumbs. */
  brandNames: Record<string, string>;
}) {
  const pathname = usePathname();
  const slug = /^\/b\/([^/]+)/.exec(pathname)?.[1];
  return (
    <TopBar
      email={email || 'Signed in'}
      theme={theme}
      mode={mode}
      breadcrumbs={crumbsFor(pathname, slug ? brandNames[slug] : undefined)}
      homeHref="/dashboard"
      homeLabel="S10/Marketing"
      searchGroups={searchGroups}
      searchPlaceholder="Search S10/Marketing"
      signOutAction="/api/auth/logout"
      linkAs={Link}
      onPreferencesChange={(t, m) => {
        void savePreferencesAction(t, m);
      }}
    />
  );
}
