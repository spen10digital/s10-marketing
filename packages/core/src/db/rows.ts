/** `db.execute()` returns `{ rows }` from both node-postgres and the Data API driver. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Postgres SQLSTATE of a (possibly Drizzle-wrapped) driver error. */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    // The Data API reports it only inside the message ("…; SQLState: 23505").
    const message = (e as { message?: unknown }).message;
    const match = typeof message === 'string' ? /SQLState: ([0-9A-Z]{5})/.exec(message) : null;
    if (match) return match[1];
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
