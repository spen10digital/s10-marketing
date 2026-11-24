import type { BrandVoiceInput } from '../domain/brands/voice-input';
import { VOICE_LIST_FIELDS, VOICE_TEXT_FIELDS, type VoiceSuggestion } from './schemas';

/** The voice editor's values, with every list present. */
export type VoiceValues = Required<{ [K in keyof BrandVoiceInput]: NonNullable<BrandVoiceInput[K]> }>;

const isText = (f: string): f is (typeof VOICE_TEXT_FIELDS)[number] =>
  (VOICE_TEXT_FIELDS as readonly string[]).includes(f);
const isList = (f: string): f is (typeof VOICE_LIST_FIELDS)[number] =>
  (VOICE_LIST_FIELDS as readonly string[]).includes(f);

/**
 * Whether a "Tune" suggestion makes sense for the current values (e.g. `replace` only on text
 * fields, `remove` only for an item that exists). Suggestions that don't apply are not shown.
 */
export function suggestionApplies(values: VoiceValues, s: VoiceSuggestion): boolean {
  if (isText(s.field)) return s.action === 'replace' && s.value !== values[s.field];
  if (!isList(s.field)) return false;
  const items = values[s.field];
  if (s.action === 'add') return !items.some((i) => i.trim().toLowerCase() === s.value.trim().toLowerCase());
  if (s.action === 'remove') return items.some((i) => i.trim() === s.value.trim());
  return false;
}

/** Applies one accepted suggestion to the editor values (nothing is saved here). */
export function applySuggestion(values: VoiceValues, s: VoiceSuggestion): VoiceValues {
  if (!suggestionApplies(values, s)) return values;
  if (isText(s.field)) return { ...values, [s.field]: s.value };
  if (!isList(s.field)) return values;
  const items = values[s.field];
  return {
    ...values,
    [s.field]: s.action === 'add' ? [...items, s.value] : items.filter((i) => i.trim() !== s.value.trim()),
  };
}
