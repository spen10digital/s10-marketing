'use client';

import { WorkspaceSwitcher } from '@spen10digital/s10-ui/client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ALL_BRANDS_ID, brandHref, brandSlugOf } from './workspace-nav';

/**
 * The shared S10 workspace switcher, as in S10/Mail. In Marketing a workspace is a brand (a Suite
 * business): the list is the brands this person can see, the choice is the URL, so there is no
 * cookie and nothing to check twice. "New workspace" goes to the Suite, where businesses are made.
 */
export function BrandWorkspaceSwitcher({
  brands,
  roleLabel,
  newWorkspaceHref,
}: {
  brands: { slug: string; name: string }[];
  roleLabel: string;
  newWorkspaceHref: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  if (brands.length === 0) return null;

  const slug = brandSlugOf(pathname);
  const options = [
    { id: ALL_BRANDS_ID, name: 'All brands', subtitle: roleLabel },
    ...brands.map((b) => ({ id: b.slug, name: b.name, subtitle: roleLabel })),
  ];
  const current = options.find((o) => o.id === slug) ?? options[0]!;

  return (
    <WorkspaceSwitcher
      current={current}
      workspaces={options}
      heading="Workspaces"
      action={{ label: 'New workspace', href: newWorkspaceHref }}
      linkAs={Link}
      onSelect={(id) => router.push(id === ALL_BRANDS_ID ? '/dashboard' : brandHref(pathname, id))}
    />
  );
}
