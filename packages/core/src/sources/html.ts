/**
 * Reduces HTML to readable text, a title and same-page links. Regex-based on purpose: the input
 * is untrusted and never rendered or executed, we only need its words.
 */
export interface HtmlText {
  title: string | null;
  description: string | null;
  text: string;
  links: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string, maxChars = 20_000): HtmlText {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)].map((m) =>
    decodeEntities(m[1]!),
  );

  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|head|title|nav|footer|form)\b[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    // Lines are already split, so \s here only collapses spaces, tabs and non-breaking spaces.
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars);
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300) || null : null,
    description: description ? decodeEntities(description).trim().slice(0, 500) || null : null,
    text,
    links,
  };
}
