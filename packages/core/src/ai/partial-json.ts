/**
 * Best-effort parse of a JSON document that is still streaming in, so the Studio can show drafts
 * as they are written. Closes an open string and any open arrays/objects, dropping a dangling key
 * or separator. Returns undefined when nothing usable has arrived yet. Display only: the final
 * text is always parsed strictly and validated on the server. Safe for the browser bundle.
 */
export function parsePartialJson(text: string): unknown {
  let candidate = text;
  for (let attempt = 0; attempt < 4 && candidate.trim() !== ''; attempt += 1) {
    const state = scan(candidate);
    let closed = candidate;
    if (state.inString) closed += state.escaped ? '\\"' : '"';
    closed = closed.replace(/[,:]\s*$/, '');
    closed += state.open
      .reverse()
      .map((c) => (c === '{' ? '}' : ']'))
      .join('');
    try {
      return JSON.parse(closed);
    } catch {
      // A half-written key or literal can't be closed; drop it and try again.
      const shorter = candidate.replace(/,?\s*("(?:[^"\\]|\\.)*"?\s*:?|[^\s{}[\],:"]+)\s*$/, '');
      if (shorter === candidate) return undefined;
      candidate = shorter;
    }
  }
  return undefined;
}

function scan(text: string) {
  const open: ('{' | '[')[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') open.push(ch);
    else if (ch === '}' || ch === ']') open.pop();
  }
  return { open, inString, escaped };
}
