import { FACEBOOK_MAX_POST_CHARS } from './schemas';

/**
 * Checks on a post's text beyond the schema (02 §5 OutputValidator). Errors block saving;
 * warnings are shown next to the draft so a person decides.
 */
export interface PostCheck {
  level: 'error' | 'warning';
  code: 'too_long' | 'long_for_facebook' | 'avoided_phrase' | 'unexpected_link' | 'empty';
  message: string;
}

/** Facebook truncates with "See more" after a few lines; long posts are allowed but rarely read. */
export const FACEBOOK_COMFORTABLE_CHARS = 2_000;

export interface PostCheckContext {
  /** The brand's "don't" list; short entries are treated as phrases to avoid. */
  avoid?: string[];
  /** The link the post will carry. Any other URL in the text was probably invented. */
  linkUrl?: string | null;
}

export function checkFacebookPost(text: string, context: PostCheckContext = {}): PostCheck[] {
  const checks: PostCheck[] = [];
  const length = [...text].length;
  if (text.trim() === '') {
    checks.push({ level: 'error', code: 'empty', message: 'The post is empty.' });
  }
  if (length > FACEBOOK_MAX_POST_CHARS) {
    checks.push({
      level: 'error',
      code: 'too_long',
      message: `Facebook allows at most ${FACEBOOK_MAX_POST_CHARS.toLocaleString('en-US')} characters (this has ${length.toLocaleString('en-US')}).`,
    });
  } else if (length > FACEBOOK_COMFORTABLE_CHARS) {
    checks.push({
      level: 'warning',
      code: 'long_for_facebook',
      message: `Long for Facebook (${length.toLocaleString('en-US')} characters); most readers only see the first few lines.`,
    });
  }

  const lower = text.toLowerCase();
  for (const phrase of context.avoid ?? []) {
    const p = phrase.trim().toLowerCase();
    if (p.length >= 3 && p.length <= 40 && lower.includes(p)) {
      checks.push({
        level: 'warning',
        code: 'avoided_phrase',
        message: `Uses “${phrase.trim()}”, which the brand avoids.`,
      });
    }
  }

  const expected = normalizeUrl(context.linkUrl);
  for (const url of text.match(/https?:\/\/[^\s)>\]"']+/gi) ?? []) {
    if (normalizeUrl(url) !== expected) {
      checks.push({
        level: 'warning',
        code: 'unexpected_link',
        message: `Contains a link that wasn’t provided (${url}). Check it before posting.`,
      });
    }
  }
  return checks;
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .trim()
    .replace(/[.,;!?]+$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}
