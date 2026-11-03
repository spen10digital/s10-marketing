import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@s10/core';
import type { OrgSummary } from '@s10/core/domain';
import { Badge } from '@/components/ui/badge';
import { OrgSwitcher } from './org-switcher';

const nav = [
  { label: 'Dashboard', href: '/dashboard', milestone: null },
  { label: 'Studio', href: '/studio', milestone: null },
  { label: 'Queue', href: null, milestone: 'M1.5' },
  { label: 'Media', href: null, milestone: 'M1.6' },
  { label: 'Calendar', href: null, milestone: 'M2.2' },
  { label: 'Sources', href: null, milestone: 'M2.3' },
  { label: 'Automations', href: null, milestone: 'M2.4' },
] as const;

export interface AppShellProps {
  appEnv: string;
  orgs: OrgSummary[];
  currentOrgId: string | null;
  userEmail: string | null;
  children: ReactNode;
}

export function AppShell({ appEnv, orgs, currentOrgId, userEmail, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col border-b border-border md:w-64 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            {PRODUCT_NAME}
          </Link>
          <Badge variant={appEnv === 'prod' ? 'success' : 'warning'}>{appEnv}</Badge>
        </div>
        <div className="px-3 pb-3">
          <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
                aria-disabled="true"
                title={`Arrives in ${item.milestone}`}
              >
                {item.label}
                <span className="text-[10px] tracking-wide uppercase opacity-70">{item.milestone}</span>
              </span>
            ),
          )}
        </nav>
        <div className="mt-auto hidden flex-col gap-2 border-t border-border px-5 py-4 text-sm md:flex">
          {userEmail ? (
            <span className="truncate text-muted-foreground" title={userEmail}>
              {userEmail}
            </span>
          ) : null}
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-sm font-medium hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
