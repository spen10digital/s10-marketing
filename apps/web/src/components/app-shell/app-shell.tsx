import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@s10/core';
import { Badge } from '@/components/ui/badge';

const nav = [
  { label: 'Dashboard', href: '/dashboard', milestone: null },
  { label: 'Studio', href: null, milestone: 'M1.3' },
  { label: 'Queue', href: null, milestone: 'M1.5' },
  { label: 'Media', href: null, milestone: 'M1.6' },
  { label: 'Calendar', href: null, milestone: 'M2.2' },
  { label: 'Sources', href: null, milestone: 'M2.3' },
  { label: 'Automations', href: null, milestone: 'M2.4' },
] as const;

export function AppShell({ appEnv, children }: { appEnv: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            {PRODUCT_NAME}
          </Link>
          <Badge variant={appEnv === 'prod' ? 'success' : 'warning'}>{appEnv}</Badge>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-md bg-muted px-3 py-2 text-sm font-medium"
                aria-current="page"
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
      </aside>
      <main className="flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
