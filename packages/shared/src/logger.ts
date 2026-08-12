/**
 * Dependency-free, secret-redacting structured logger.
 *
 * Deliberately not pino: this module lives in @chainsre/shared, which is
 * imported by both the API and the browser bundle, so it must have zero
 * runtime dependencies and no Node-only imports. It emits one JSON object per
 * line and redacts secrets both by key name and by value pattern so a stray
 * API key or token never lands in logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Return a new logger that merges `bindings` into every record. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Static fields merged into every record (e.g. { service: 'api' }). */
  base?: LogFields;
  /** Where a formatted line is written. Defaults to console.log. Injectable for tests. */
  sink?: (line: string) => void;
  /** Clock, injectable for deterministic tests. Defaults to () => new Date().toISOString(). */
  now?: () => string;
}

const REDACTED = '[REDACTED]';

/** Substrings that mark a key as sensitive (case-insensitive). */
const REDACT_KEY_PATTERNS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'session',
  'privatekey',
  'private_key',
  'mnemonic',
  'seed',
  'credential',
  'signature',
  'service_role',
];

/**
 * Value patterns that look like credentials even when the key name is innocent.
 * Covers KeeperHub keys (kh_...), GitHub tokens (ghp_/gho_/ghs_/ghu_/ghr_...),
 * bearer tokens, and PEM private-key blocks.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bkh_[A-Za-z0-9]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /-----BEGIN(?:\s[A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?:\s[A-Z]+)? PRIVATE KEY-----/g,
];

function keyLooksSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((p) => k.includes(p));
}

function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Recursively redact a value: sensitive keys are masked entirely, and every
 * string is scanned for secret-shaped substrings. Guards against cycles.
 */
export function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = keyLooksSensitive(k) ? REDACTED : redactValue(v, seen);
  }
  return out;
}

function defaultSink(line: string): void {
  console.log(line);
}

function defaultNow(): string {
  return new Date().toISOString();
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const threshold = LEVEL_ORDER[level];
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? defaultNow;

  function emit(recordLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_ORDER[recordLevel] < threshold) {
      return;
    }
    const merged: LogFields = { ...base, ...(fields ?? {}) };
    const record = {
      level: recordLevel,
      time: now(),
      msg: redactString(msg),
      ...(redactValue(merged) as Record<string, unknown>),
    };
    sink(JSON.stringify(record));
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (bindings) =>
      createLogger({
        level,
        base: { ...base, ...bindings },
        sink,
        now,
      }),
  };
}
