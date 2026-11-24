'use client';

import { AppSidebar, type NavItem } from '@spen10digital/s10-ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isCurrent, NAV } from './nav';

/** The s10-ui sidebar with the current page marked (needs the path, so it is a Client Component). */
export function AppNav({ header, footer }: { header?: ReactNode; footer?: ReactNode }) {
  const pathname = usePathname();
  const items: NavItem[] = NAV.map((n) => ({ ...n, current: isCurrent(pathname, n.href) }));
  return <AppSidebar appName="S10/Marketing" items={items} header={header} footer={footer} linkAs={Link} />;
}
