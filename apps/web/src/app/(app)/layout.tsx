import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { getConfig } from '@/server/config';
import { getOrgContext } from '@/server/org-context';

export const dynamic = 'force-dynamic';

/** Everything under (app) requires a signed-in user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [config, { orgs, current, email }] = await Promise.all([getConfig(), getOrgContext()]);
  return (
    <AppShell appEnv={config.APP_ENV} orgs={orgs} currentOrgId={current?.id ?? null} userEmail={email}>
      {children}
    </AppShell>
  );
}
