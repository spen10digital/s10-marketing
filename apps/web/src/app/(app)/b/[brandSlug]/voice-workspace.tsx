'use client';

import {
  applySuggestion,
  suggestionApplies,
  type VoiceDraftOutput,
  type VoiceField,
  type VoiceSamplesOutput,
  type VoiceSuggestion,
  type VoiceTuneOutput,
  type VoiceValues,
} from '@s10/core/ai/client';
import { useRef, useState } from 'react';
import { useAiStream } from '@/components/ai/use-ai-stream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { EMPTY_VOICE, readVoiceForm, VoiceForm } from './voice-form';

const FIELD_LABELS: Record<VoiceField, string> = {
  audience: 'Audience',
  tone: 'Tone',
  guidelines: 'Guidelines',
  doList: 'Do',
  dontList: 'Don’t',
  examplePosts: 'Example posts',
  ctaDefaults: 'Calls to action',
};

interface Props {
  brandId: string;
  brandSlug: string;
  websiteUrl: string | null;
  /** The saved version (null before the first save). */
  saved: (VoiceValues & { version: number }) | null;
  canEdit: boolean;
}

/**
 * The voice editor plus the Brand Voice assistant (M1.3). AI output is only ever a proposal: it
 * is shown against the saved version and, if accepted, copied into the editor. Saving still goes
 * through the editor and creates a normal new version.
 */
export function VoiceWorkspace({ brandId, brandSlug, websiteUrl, saved, canEdit }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const savedValues: VoiceValues = saved ?? EMPTY_VOICE;
  const [values, setValues] = useState<VoiceValues>(savedValues);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const current = () => (formRef.current ? readVoiceForm(formRef.current) : values);
  const putInEditor = (next: VoiceValues, message: string) => {
    setValues(next);
    setFormKey((k) => k + 1); // remount the uncontrolled form with the new values
    setNotice(message);
  };

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <VoiceAssistant
          brandSlug={brandSlug}
          websiteUrl={websiteUrl}
          saved={savedValues}
          current={current}
          putInEditor={putInEditor}
        />
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md bg-primary/10 px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <VoiceForm
        key={formKey}
        formRef={formRef}
        brandId={brandId}
        brandSlug={brandSlug}
        version={saved?.version ?? 0}
        values={values}
        disabled={!canEdit}
      />
    </div>
  );
}

type Mode = 'website' | 'guided' | 'tune' | 'samples';

function VoiceAssistant({
  brandSlug,
  websiteUrl,
  saved,
  current,
  putInEditor,
}: {
  brandSlug: string;
  websiteUrl: string | null;
  saved: VoiceValues;
  current: () => VoiceValues;
  putInEditor: (values: VoiceValues, message: string) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [url, setUrl] = useState(websiteUrl ?? '');
  const [answers, setAnswers] = useState({ audience: '', sound: '', avoid: '', examples: '' });
  const [topic, setTopic] = useState('');
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const draft = useAiStream<VoiceDraftOutput>(brandSlug);
  const tune = useAiStream<VoiceTuneOutput>(brandSlug);
  const samples = useAiStream<VoiceSamplesOutput>(brandSlug);

  const tabs: [Mode, string][] = [
    ['website', 'Draft from website'],
    ['guided', 'Guided setup'],
    ['tune', 'Tune'],
    ['samples', 'Try it'],
  ];

  return (
    <section
      aria-label="Brand Voice assistant"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Brand Voice assistant</h3>
        <p className="text-xs text-muted-foreground">
          Suggestions only. Nothing is saved until you save a new version.
        </p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={mode === id}
            variant={mode === id ? 'primary' : 'secondary'}
            onClick={() => setMode(mode === id ? null : id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === 'website' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void draft.run({ action: 'voice_from_website', input: { url } });
          }}
        >
          <Field
            label="Brand website"
            htmlFor="voiceUrl"
            hint="We read the home page and up to 4 pages like About or the blog."
          >
            <Input id="voiceUrl" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={draft.status === 'streaming'}>
              {draft.status === 'streaming' ? 'Reading and drafting…' : 'Draft voice'}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === 'guided' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void draft.run({ action: 'voice_from_answers', input: answers });
          }}
        >
          {(
            [
              ['audience', 'Who is it for?'],
              ['sound', 'How should it sound?'],
              ['avoid', 'Words or topics to avoid'],
              ['examples', 'Posts you like (paste a few)'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`q-${key}`}>
              <Textarea
                id={`q-${key}`}
                value={answers[key]}
                maxLength={key === 'examples' ? 6000 : 1000}
                onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })}
              />
            </Field>
          ))}
          <div>
            <Button type="submit" disabled={draft.status === 'streaming'}>
              {draft.status === 'streaming' ? 'Drafting…' : 'Draft voice'}
            </Button>
          </div>
        </form>
      ) : null}

      {(mode === 'website' || mode === 'guided') &&
      (draft.output || draft.status === 'streaming' || draft.error) ? (
        <Proposal
          saved={saved}
          proposal={(draft.output ?? draft.partial ?? {}) as Partial<VoiceValues>}
          complete={draft.status === 'done'}
          error={draft.error}
          onUse={() =>
            draft.output &&
            putInEditor(
              draft.output,
              'The drafted voice is in the editor. Review it, then save a new version.',
            )
          }
        />
      ) : null}

      {mode === 'tune' ? (
        <div className="flex flex-col gap-3">
          <div>
            <Button
              type="button"
              disabled={tune.status === 'streaming'}
              onClick={() => {
                setDismissed(new Set());
                void tune.run({ action: 'voice_tune', input: current() });
              }}
            >
              {tune.status === 'streaming' ? 'Reviewing…' : 'Review the voice in the editor'}
            </Button>
          </div>
          {tune.error ? <p className="text-sm text-danger">{tune.error}</p> : null}
          {tune.output ? (
            <Suggestions
              suggestions={tune.output.suggestions}
              dismissed={dismissed}
              current={current}
              onAccept={(s) =>
                putInEditor(
                  applySuggestion(current(), s),
                  `Applied: ${FIELD_LABELS[s.field]}. Save a new version to keep it.`,
                )
              }
              onDismiss={(i) => setDismissed(new Set(dismissed).add(i))}
            />
          ) : null}
        </div>
      ) : null}

      {mode === 'samples' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void samples.run({
              action: 'voice_samples',
              input: { voice: current(), topic: topic || undefined },
            });
          }}
        >
          <Field
            label="Topic (optional)"
            htmlFor="sampleTopic"
            hint="Sample posts use the voice as it is in the editor now, saved or not."
          >
            <Input
              id="sampleTopic"
              value={topic}
              maxLength={500}
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" disabled={samples.status === 'streaming'}>
              {samples.status === 'streaming' ? 'Writing…' : 'Write sample posts'}
            </Button>
          </div>
          {samples.error ? <p className="text-sm text-danger">{samples.error}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            {((samples.output ?? samples.partial ?? {}) as Partial<VoiceSamplesOutput>).samples?.map(
              (s, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
                  {s.angle ? <Badge>{s.angle}</Badge> : null}
                  <p className="whitespace-pre-line">{s.text}</p>
                </div>
              ),
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}

function show(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map((v) => `• ${String(v)}`).join('\n') : '(empty)';
  return value ? String(value) : '(empty)';
}

/** The drafted profile next to the saved version, field by field. */
function Proposal({
  saved,
  proposal,
  complete,
  error,
  onUse,
}: {
  saved: VoiceValues;
  proposal: Partial<VoiceValues>;
  complete: boolean;
  error: string | null;
  onUse: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <table className="w-full table-fixed text-left text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="w-28 py-1 font-medium">Field</th>
            <th className="py-1 font-medium">Saved version</th>
            <th className="py-1 font-medium">Proposed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border align-top">
          {(Object.keys(FIELD_LABELS) as VoiceField[]).map((field) => {
            const changed = JSON.stringify(saved[field]) !== JSON.stringify(proposal[field] ?? saved[field]);
            return (
              <tr key={field}>
                <th scope="row" className="py-2 font-medium">
                  {FIELD_LABELS[field]}
                </th>
                <td className="py-2 pr-3 whitespace-pre-line text-muted-foreground">{show(saved[field])}</td>
                <td
                  className={`py-2 whitespace-pre-line ${changed ? 'font-medium' : 'text-muted-foreground'}`}
                >
                  {proposal[field] === undefined ? '…' : show(proposal[field])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {complete ? (
        <div>
          <Button type="button" onClick={onUse}>
            Use this draft in the editor
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Suggestions({
  suggestions,
  dismissed,
  current,
  onAccept,
  onDismiss,
}: {
  suggestions: VoiceSuggestion[];
  dismissed: Set<number>;
  current: () => VoiceValues;
  onAccept: (s: VoiceSuggestion) => void;
  onDismiss: (i: number) => void;
}) {
  const values = current();
  const open = suggestions
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !dismissed.has(i) && suggestionApplies(values, s));
  if (open.length === 0)
    return <p className="text-sm text-muted-foreground">No (more) suggestions. The voice looks good.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {open.map(({ s, i }) => (
        <li key={i} className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge>{FIELD_LABELS[s.field]}</Badge>
            <span className="text-xs text-muted-foreground">
              {s.action === 'replace' ? 'rewrite' : s.action}
            </span>
          </div>
          <p className="whitespace-pre-line">{s.value}</p>
          <p className="text-xs text-muted-foreground">{s.reason}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onAccept(s);
                onDismiss(i);
              }}
            >
              Accept
            </Button>
            <Button type="button" variant="ghost" onClick={() => onDismiss(i)}>
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
