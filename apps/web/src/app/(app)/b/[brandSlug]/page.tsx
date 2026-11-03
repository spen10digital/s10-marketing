import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { withDbContext } from '@s10/core/db';
import { can, getBrandBySlug, getCurrentVoice, listVoiceVersions } from '@s10/core/domain';
import { BrandForm } from '@/app/(app)/brands/brand-form';
import { setBrandArchivedAction } from '@/app/(app)/actions';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/server/db';
import { requireOrgActor } from '@/server/org-context';
import { VoiceWorkspace } from './voice-workspace';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ brandSlug: string }>; searchParams: Promise<{ saved?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).brandSlug };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const [{ brandSlug }, { saved }] = await Promise.all([params, searchParams]);
  const actor = await requireOrgActor();
  const data = await withDbContext(await getDb(), { userId: actor.userId }, async (tx) => {
    const brand = await getBrandBySlug(tx, actor.orgId, brandSlug);
    if (!brand) return null;
    const [voice, versions] = await Promise.all([
      getCurrentVoice(tx, actor.orgId, brand.id),
      listVoiceVersions(tx, actor.orgId, brand.id),
    ]);
    return { brand, voice, versions };
  });
  if (!data) notFound();
  const { brand, voice, versions } = data;
  const canEditBrand = can(actor.role, 'brand.update');
  const canEditVoice = can(actor.role, 'brand.voice.update');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {brand.name}
            {brand.archivedAt ? <Badge>archived</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">{actor.org.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <ButtonLink href={`/b/${brand.slug}/studio`}>Open studio</ButtonLink>
          {canEditBrand ? (
            <form action={setBrandArchivedAction}>
              <input type="hidden" name="brandId" value={brand.id} />
              <input type="hidden" name="archived" value={brand.archivedAt ? 'false' : 'true'} />
              <button type="submit" className="text-sm text-muted-foreground hover:underline">
                {brand.archivedAt ? 'Restore brand' : 'Archive brand'}
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {saved ? (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {saved === 'voice' ? `Voice saved as version ${voice?.version ?? 1}.` : 'Brand details saved.'}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Brand voice</CardTitle>
            <CardDescription>
              Used by the AI studio to write on-brand drafts. Every save creates a new version; the assistant
              can draft or tune it for you.
              {canEditVoice ? null : ' Only editors and above can change it.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoiceWorkspace
              key={voice?.version ?? 0}
              brandId={brand.id}
              brandSlug={brand.slug}
              websiteUrl={brand.websiteUrl}
              saved={
                voice && {
                  version: voice.version,
                  audience: voice.audience,
                  tone: voice.tone,
                  guidelines: voice.guidelines,
                  doList: voice.doList,
                  dontList: voice.dontList,
                  examplePosts: voice.examplePosts,
                  ctaDefaults: voice.ctaDefaults,
                }
              }
              canEdit={canEditVoice}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              {canEditBrand ? null : (
                <CardDescription>Only owners and admins can edit these.</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <BrandForm
                brand={brand}
                timeZones={Intl.supportedValuesOf('timeZone')}
                orgTimeZone={actor.org.timezone}
                disabled={!canEditBrand}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Voice history</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No versions yet.</p>
              ) : (
                <ol className="divide-y divide-border text-sm">
                  {versions.map((v) => (
                    <li key={v.id} className="flex justify-between gap-3 py-2">
                      <span className="font-mono text-xs">v{v.version}</span>
                      <span className="truncate text-muted-foreground" title={v.createdByEmail ?? undefined}>
                        {v.createdByEmail ?? 'unknown'}
                      </span>
                      <time
                        className="shrink-0 text-muted-foreground"
                        dateTime={new Date(v.createdAt).toISOString()}
                      >
                        {new Date(v.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
