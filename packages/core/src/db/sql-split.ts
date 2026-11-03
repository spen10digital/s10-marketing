/**
 * Splits a migration file into single statements. The RDS Data API executes one statement per
 * call, so the runner cannot hand it a whole file. Understands line and block comments, quoted
 * strings and identifiers, and dollar-quoted bodies ($$ … $$, $tag$ … $tag$).
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  const push = () => {
    const trimmed = stripComments(current).trim();
    if (trimmed) statements.push(current.trim());
    current = '';
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Unterminated block comment');
      current += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = closingQuote(sql, i, ch);
      current += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new Error(`Unterminated dollar-quoted string ${tag}`);
        current += sql.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }
    if (ch === ';') {
      push();
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  push();
  return statements;
}

function closingQuote(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2; // doubled quote is an escaped quote
        continue;
      }
      return i;
    }
    i += 1;
  }
  throw new Error(`Unterminated ${quote === "'" ? 'string' : 'identifier'}`);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
