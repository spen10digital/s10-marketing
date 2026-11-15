import { AppError } from '../errors/app-error';
import { htmlToText } from './html';
import { checkUrl, isAllowedByRobots, safeFetch, type SafeFetchOptions } from './safe-fetch';

/**
 * Reads a brand's site for the voice assistant: the home page plus up to 4 same-site pages that
 * look like About/story/blog pages. Respects robots.txt, stays on the same origin, and caps the
 * text sent to the model.
 */
export interface WebsitePage {
  url: string;
  title: string | null;
  text: string;
}

export const MAX_EXTRA_PAGES = 4;
const HOME_CHARS = 6_000;
const PAGE_CHARS = 3_000;
const TOTAL_TIME_MS = 30_000;
const PREFERRED = /(about|story|mission|values|who-we-are|team|blog|news|posts|articles|journal)/i;

export async function readWebsite(rawUrl: string, options: SafeFetchOptions = {}): Promise<WebsitePage[]> {
  const start = checkUrl(rawUrl, options.allowedPorts);
  const signal = options.signal ?? AbortSignal.timeout(TOTAL_TIME_MS);
  const fetchOptions = { ...options, signal };

  if (!(await isAllowedByRobots(start, fetchOptions))) {
    throw new AppError(
      'BAD_REQUEST',
      'This website asks automated tools not to read that page (robots.txt).',
    );
  }
  const home = await safeFetch(start.toString(), fetchOptions);
  const homeUrl = new URL(home.url);
  const parsed = htmlToText(home.body, HOME_CHARS);
  const pages: WebsitePage[] = [
    {
      url: home.url,
      title: parsed.title,
      text: [parsed.description, parsed.text].filter(Boolean).join('\n\n'),
    },
  ];

  for (const url of pickPages(homeUrl, parsed.links)) {
    if (signal.aborted) break;
    try {
      if (!(await isAllowedByRobots(url, fetchOptions))) continue;
      const res = await safeFetch(url.toString(), fetchOptions);
      if (new URL(res.url).origin !== homeUrl.origin) continue; // redirected off-site
      const page = htmlToText(res.body, PAGE_CHARS);
      if (page.text) pages.push({ url: res.url, title: page.title, text: page.text });
    } catch {
      // A broken subpage doesn't spoil the draft; the home page is enough.
    }
  }
  return pages;
}

/** Same-origin links, About-like pages first, at most MAX_EXTRA_PAGES. */
export function pickPages(home: URL, links: string[]): URL[] {
  const seen = new Set([normalize(home)]);
  const candidates: URL[] = [];
  for (const href of links) {
    let url: URL;
    try {
      url = new URL(href, home);
    } catch {
      continue;
    }
    if (url.origin !== home.origin) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|xml|json)$/i.test(url.pathname)) continue;
    url.hash = '';
    const key = normalize(url);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(url);
  }
  return candidates
    .map((url, i) => ({ url, score: (PREFERRED.test(url.pathname) ? 0 : 1) * 1000 + i }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_EXTRA_PAGES)
    .map((c) => c.url);
}

function normalize(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

/** Reads one article page (Studio "from article"). */
export async function readArticle(rawUrl: string, options: SafeFetchOptions = {}): Promise<WebsitePage> {
  const url = checkUrl(rawUrl, options.allowedPorts);
  const fetchOptions = { ...options, signal: options.signal ?? AbortSignal.timeout(15_000) };
  if (!(await isAllowedByRobots(url, fetchOptions))) {
    throw new AppError(
      'BAD_REQUEST',
      'This website asks automated tools not to read that page (robots.txt).',
    );
  }
  const res = await safeFetch(url.toString(), fetchOptions);
  const page = htmlToText(res.body, 15_000);
  if (!page.text) throw new AppError('BAD_REQUEST', 'No readable text was found on that page.');
  return { url: res.url, title: page.title, text: page.text };
}

/** What is stored next to a generation: a short excerpt, never the whole page (roadmap M1.3). */
export function excerptOf(pages: WebsitePage[], max = 500): string {
  return pages
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, max);
}
