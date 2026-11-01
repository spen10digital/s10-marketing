import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getConfig } from '@/server/config';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const milestones = [
  { id: 'M1.1', label: 'Repository & AWS foundation', status: 'in progress' },
  { id: 'M1.2', label: 'Sign-in, organizations, brands & voice', status: 'next' },
  { id: 'M1.3', label: 'AI content studio (Bedrock)', status: 'planned' },
  { id: 'M1.4', label: 'Facebook Page connection', status: 'planned' },
  { id: 'M1.5', label: 'Approval & publishing', status: 'planned' },
  { id: 'M1.6', label: 'Images & media library', status: 'planned' },
] as const;

const statusVariant = { 'in progress': 'primary', next: 'warning', planned: 'default' } as const;

export default async function DashboardPage() {
  const config = await getConfig();

  return (
    <AppShell appEnv={config.APP_ENV}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            The foundation is in place. Brands, drafts and the publishing queue appear here as milestones
            land.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Environment</CardDescription>
              <CardTitle className="text-xl">{config.APP_ENV}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Publishing</CardDescription>
              <CardTitle className="text-xl">{config.PUBLISHING_ENABLED ? 'Enabled' : 'Disabled'}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Kill switch: PUBLISHING_ENABLED
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Meta Graph API</CardDescription>
              <CardTitle className="text-xl">{config.META_GRAPH_VERSION}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Build progress</CardTitle>
            <CardDescription>Phase 1 — internal MVP</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-border">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{m.id}</span>
                    <span className="truncate">{m.label}</span>
                  </span>
                  <Badge variant={statusVariant[m.status]}>{m.status}</Badge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
