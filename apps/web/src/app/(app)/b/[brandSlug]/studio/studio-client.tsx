'use client';

import {
  checkFacebookPost,
  type ArticleSummaryOutput,
  type CampaignConceptsOutput,
  type PostVariantsOutput,
  type RewriteOutput,
} from '@s10/core/ai/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { savePostDraftAction } from '@/app/(app)/actions';
import { useAiStream } from '@/components/ai/use-ai-stream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

interface Props {
  brandId: string;
  brandSlug: string;
  defaultLinkUrl: string;
  avoid: string[];
}

type PartialVariants = { variants?: Partial<PostVariantsOutput['variants'][number]>[] };
type PartialConcepts = { concepts?: Partial<CampaignConceptsOutput['concepts'][number]>[] };

export function StudioClient(props: Props) {
  const [tab, setTab] = useState<'posts' | 'campaigns'>('posts');
  const [brief, setBrief] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Studio mode" className="flex gap-1">
        {(
          [
            ['posts', 'Posts'],
            ['campaigns', 'Campaign ideas'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'ghost'}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'posts' ? (
        <PostsPanel {...props} brief={brief} setBrief={setBrief} />
      ) : (
        <CampaignsPanel
          brandSlug={props.brandSlug}
          onUse={(text) => {
            setBrief(text);
            setTab('posts');
          }}
        />
      )}
    </div>
  );
}

function PostsPanel({
  brandId,
  brandSlug,
  defaultLinkUrl,
  avoid,
  brief,
  setBrief,
}: Props & { brief: string; setBrief: (v: string) => void }) {
  const [linkUrl, setLinkUrl] = useState(defaultLinkUrl);
  const [articleUrl, setArticleUrl] = useState('');
  const [count, setCount] = useState(3);
  const generate = useAiStream<PostVariantsOutput>(brandSlug);
  const summarize = useAiStream<ArticleSummaryOutput>(brandSlug);
  const partial = (generate.partial ?? {}) as PartialVariants;
  const variants = generate.output?.variants ?? partial.variants ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Write posts</CardTitle>
          <CardDescription>
            Claude Sonnet drafts several angles in the brand voice. Nothing is posted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void generate.run({
                action: 'generate_variants',
                input: { brief, linkUrl, articleUrl, count },
              });
            }}
          >
            <Field label="What is the post about?" htmlFor="brief" hint="A sentence or two is enough.">
              <Textarea
                id="brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={4000}
                required
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Link to attach (optional)" htmlFor="linkUrl">
                <Input id="linkUrl" type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
              </Field>
              <Field
                label="Base it on an article (optional)"
                htmlFor="articleUrl"
                hint="The page is read and used as the only source of facts."
              >
                <div className="flex gap-2">
                  <Input
                    id="articleUrl"
                    type="url"
                    value={articleUrl}
                    onChange={(e) => setArticleUrl(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!articleUrl || summarize.status === 'streaming'}
                    onClick={async () => {
                      const out = await summarize.run({
                        action: 'summarize_article',
                        input: { url: articleUrl },
                      });
                      if (out) setBrief([out.summary, ...out.keyPoints.map((p) => `- ${p}`)].join('\n'));
                    }}
                  >
                    {summarize.status === 'streaming' ? 'Reading…' : 'Summarize'}
                  </Button>
                </div>
              </Field>
            </div>
            {summarize.error ? <p className="text-sm text-danger">{summarize.error}</p> : null}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Variants" htmlFor="count">
                <Select id="count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" disabled={generate.status === 'streaming' || !brief.trim()}>
                {generate.status === 'streaming' ? 'Writing…' : 'Generate drafts'}
              </Button>
              {generate.status === 'streaming' ? (
                <Button type="button" variant="ghost" onClick={generate.cancel}>
                  Stop
                </Button>
              ) : null}
            </div>
            {generate.error ? (
              <p role="alert" className="text-sm text-danger">
                {generate.error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {variants.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {variants.map((v, i) =>
            generate.output ? (
              <VariantCard
                key={`${generate.generationId}-${i}`}
                brandId={brandId}
                brandSlug={brandSlug}
                generationId={generate.generationId}
                variant={generate.output.variants[i]!}
                linkUrl={linkUrl}
                brief={brief}
                avoid={avoid}
              />
            ) : (
              <Card key={i} aria-busy="true">
                <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                  {v.angle ? <Badge>{v.angle}</Badge> : null}
                  <p className="whitespace-pre-line">{v.text ?? '…'}</p>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      ) : null}
    </>
  );
}

function VariantCard({
  brandId,
  brandSlug,
  generationId,
  variant,
  linkUrl,
  brief,
  avoid,
}: {
  brandId: string;
  brandSlug: string;
  generationId: string | null;
  variant: PostVariantsOutput['variants'][number];
  linkUrl: string;
  brief: string;
  avoid: string[];
}) {
  const router = useRouter();
  const initialText = [variant.text, variant.hashtags.join(' ')].filter(Boolean).join('\n\n');
  const [text, setText] = useState(initialText);
  const [tone, setTone] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const transform = useAiStream<RewriteOutput>(brandSlug);
  const checks = checkFacebookPost(text, { avoid, linkUrl: linkUrl || null });
  const live =
    transform.status === 'streaming'
      ? ((transform.partial as { text?: string } | undefined)?.text ?? '')
      : null;

  const runTransform = async (op: 'shorten' | 'expand' | 'tone' | 'adapt') => {
    const out = await transform.run({
      action: 'transform',
      input: { text, op, tone: op === 'tone' ? tone : undefined },
    });
    if (out) setText(out.text);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{variant.angle}</Badge>
          <span className="text-xs text-muted-foreground">{[...text].length} characters</span>
        </div>
        <Textarea
          aria-label={`Draft: ${variant.angle}`}
          className="min-h-40"
          value={live ?? text}
          readOnly={live !== null}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(null);
          }}
        />
        {checks.length ? (
          <ul className="flex flex-col gap-1 text-xs">
            {checks.map((c, i) => (
              <li key={i} className={c.level === 'error' ? 'text-danger' : 'text-warning'}>
                {c.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {(['shorten', 'expand', 'adapt'] as const).map((op) => (
            <Button
              key={op}
              type="button"
              variant="secondary"
              disabled={transform.status === 'streaming'}
              onClick={() => runTransform(op)}
            >
              {op === 'adapt' ? 'Fit for Facebook' : op[0]!.toUpperCase() + op.slice(1)}
            </Button>
          ))}
          <Input
            aria-label="Tone"
            placeholder="tone, e.g. formal"
            className="w-36"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            maxLength={100}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!tone.trim() || transform.status === 'streaming'}
            onClick={() => runTransform('tone')}
          >
            Change tone
          </Button>
        </div>
        {transform.error ? <p className="text-xs text-danger">{transform.error}</p> : null}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={saving || checks.some((c) => c.level === 'error') || transform.status === 'streaming'}
            onClick={() =>
              startSaving(async () => {
                const result = await savePostDraftAction({
                  brandId,
                  brandSlug,
                  body: text,
                  linkUrl: linkUrl || null,
                  brief,
                  aiGenerationId: generationId,
                });
                setSaved(result.message ?? null);
                if (result.status === 'success') router.refresh();
              })
            }
          >
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-muted-foreground">
              {saved}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignsPanel({ brandSlug, onUse }: { brandSlug: string; onUse: (text: string) => void }) {
  const [goal, setGoal] = useState('');
  const ideas = useAiStream<CampaignConceptsOutput>(brandSlug);
  const concepts = ideas.output?.concepts ?? ((ideas.partial ?? {}) as PartialConcepts).concepts ?? [];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Campaign ideas</CardTitle>
          <CardDescription>Concepts with a sample post each. Use one as the brief for posts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void ideas.run({ action: 'campaign_concepts', input: { goal, count: 3 } });
            }}
          >
            <Field
              label="Campaign goal"
              htmlFor="goal"
              hint="e.g. “Grow pre-orders for the winter dice set”."
            >
              <Textarea
                id="goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={2000}
                required
              />
            </Field>
            <div className="flex gap-3">
              <Button type="submit" disabled={ideas.status === 'streaming' || !goal.trim()}>
                {ideas.status === 'streaming' ? 'Thinking…' : 'Suggest concepts'}
              </Button>
            </div>
            {ideas.error ? (
              <p role="alert" className="text-sm text-danger">
                {ideas.error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {concepts.map((c, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle>{c.name ?? '…'}</CardTitle>
              <CardDescription>{c.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {c.samplePost ? (
                <p className="whitespace-pre-line rounded-md bg-muted p-3">{c.samplePost}</p>
              ) : null}
              {c.rationale ? <p className="text-muted-foreground">{c.rationale}</p> : null}
              {ideas.output ? (
                <div>
                  <Button type="button" variant="secondary" onClick={() => onUse(`${c.name}: ${c.summary}`)}>
                    Write posts for this
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
