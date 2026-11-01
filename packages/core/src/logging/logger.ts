/**
 * Structured JSON logger for CloudWatch (stdout). Values under sensitive keys are
 * redacted at any depth (05 §2 "Logging").
 */
export const REDACTED_KEYS = [
  'access_token',
  'token',
  'authorization',
  'secret',
  'ciphertext',
  'code',
] as const;

const redactedKeySet = new Set<string>(REDACTED_KEYS);
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Error) {
    // Error messages can embed upstream payloads; keep name and stack frames only.
    return { name: value.name, stack: value.stack?.split('\n').slice(1, 6).join('\n') };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = redactedKeySet.has(key.toLowerCase()) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = levelOrder[options.level ?? 'info'];
  const bindings = options.bindings ?? {};
  const write = options.write ?? ((line: string) => console.log(line));

  const log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (levelOrder[level] < minLevel) return;
    const entry = { level, time: new Date().toISOString(), msg, ...bindings, ...fields };
    write(JSON.stringify(redact(entry)));
  };

  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (more) => createLogger({ ...options, bindings: { ...bindings, ...more } }),
  };
}
