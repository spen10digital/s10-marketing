/** Pure navigation helpers (no React), so they are unit tested.
 */
export interface Crumb {
  label: string;
  href?: string;
}

/** This app's pages. Live pages only: upcoming ones (queue, media, calendar) arrive with their milestones. */
export const NAV: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/studio', label: 'Studio' },
];

/** The studio of a brand (/b/<slug>/studio) belongs to Studio; everything else under /b/ is a brand on the Dashboard. */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/studio') return pathname === '/studio' || /^\/b\/[^/]+\/studio(\/|$)/.test(pathname);
  if (href === '/dashboard')
    return (
      pathname === '/dashboard' || (pathname.startsWith('/b/') && !/^\/b\/[^/]+\/studio(\/|$)/.test(pathname))
    );
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Where you are, for the bar: names, not ids. */
export function crumbsFor(pathname: string, brandName?: string): Crumb[] {
  const root: Crumb = { label: 'S10/Marketing', href: '/dashboard' };
  if (pathname === '/dashboard') return [root, { label: 'Dashboard' }];
  if (pathname === '/studio') return [root, { label: 'Studio' }];
  if (pathname === '/no-access') return [root, { label: 'Not available' }];
  const brand = /^\/b\/([^/]+)(\/studio)?\/?$/.exec(pathname);
  if (brand) {
    const label = brandName ?? 'Brand';
    return brand[2]
      ? [root, { label: 'Studio', href: '/studio' }, { label }]
      : [root, { label: 'Dashboard', href: '/dashboard' }, { label }];
  }
  return [root];
}
