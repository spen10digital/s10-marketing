import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAiLimits, getAiUsage, microsToUsd } from '@s10/core/ai';
import { withDbContext } from '@s10/core/db';
import { can, getBrandBySlug, getCurrentVoice, listRecentPosts } from '@s10/core/domain';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { requireOrgActor } from '@/server/org-context';
import { StudioClient } from './studio-client';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ brandSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Studio · ${(await params).brandSlug}` };
}

export default async function StudioPage({ params }: Props) {
  const { brandSlug } = await params;
  const actor = await requireOrgActor();
  const config = await getConfig();
  const data = await withDbContext(await getDb(), { userId: actor.userId }, async (tx) => {
    const brand = await getBrandBySlug(tx, actor.orgId, brandSlug);
    if (!brand) return null;
    const [voice, posts, usage, limits] = await Promise.all([
      getCurrentVoice(tx, actor.orgId, brand.id),
      listRecentPosts(tx, actor.orgId, brand.id, 10),
      getAiUsage(tx, actor.orgId),
      getAiLimits(tx, actor.orgId, config.AI_DEFAULT_MONTHLY_BUDGET_USD),
    ]);
    return { brand, voice, posts, usage, limits };
  });
  if (!data) notFound();
  const { brand, voice, posts, usage, limits } = data;
  const canGenerate = can(actor.role, 'ai.generate');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/b/${brand.slug}`} className="hover:underline">
              {brand.name}
            </Link>{' '}
            · drafts are saved unassigned; approval and publishing arrive in M1.5
          </p>
        </div>
        <p className="text-sm text-muted-foreground" title="This organization’s AI spend this month (UTC)">
          AI this month: ${microsToUsd(usage.spentMicros).toFixed(2)} of $
          {microsToUsd(limits.monthlyBudgetMicros).toFixed(2)} · {usage.callsToday}/{limits.dailyCalls}{' '}
          requests today
        </p>
      </header>

      {!voice ? (
        <p role="status" className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          This brand has no voice profile yet, so drafts will sound generic.{' '}
          <Link href={`/b/${brand.slug}`} className="font-medium underline">
            Set up the voice
          </Link>{' '}
          first for better results.
        </p>
      ) : null}

      {canGenerate ? (
        <StudioClient
          brandId={brand.id}
          brandSlug={brand.slug}
          defaultLinkUrl={brand.websiteUrl ?? ''}
          avoid={voice?.dontList ?? []}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Only editors and above can generate drafts.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent drafts</CardTitle>
          <CardDescription>
            The latest posts saved for {brand.name}. The AI avoids repeating them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drafts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {posts.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge>{p.status}</Badge>
                    {p.aiGenerationId ? <span>AI-assisted</span> : null}
                    <time dateTime={new Date(p.updatedAt).toISOString()}>
                      {new Date(p.updatedAt).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-line">{p.body}</p>
                  {p.linkUrl ? <p className="truncate text-xs text-muted-foreground">{p.linkUrl}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
