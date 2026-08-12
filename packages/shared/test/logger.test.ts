import { describe, expect, it } from 'vitest';

import { createLogger, redactValue } from '../src/logger';

function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    base: { service: 'test' },
    sink: (line) => lines.push(line),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  return { logger, lines };
}

describe('logger', () => {
  it('emits one JSON line per record with level, time, msg and base fields', () => {
    const { logger, lines } = capture();
    logger.info('hello', { requestId: 'r1' });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      level: 'info',
      time: '2026-01-01T00:00:00.000Z',
      msg: 'hello',
      service: 'test',
      requestId: 'r1',
    });
  });

  it('respects the level threshold', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
    logger.info('skipped');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).msg).toBe('kept');
  });

  it('redacts sensitive keys entirely', () => {
    const { logger, lines } = capture();
    logger.info('login', { password: 'hunter2', apiKey: 'x', authorization: 'Bearer y' });
    const record = JSON.parse(lines[0]!);
    expect(record.password).toBe('[REDACTED]');
    expect(record.apiKey).toBe('[REDACTED]');
    expect(record.authorization).toBe('[REDACTED]');
  });

  it('redacts secret-shaped values even under innocent keys', () => {
    const { logger, lines } = capture();
    logger.info('call', { note: 'using kh_abcdef123456 for the call' });
    const record = JSON.parse(lines[0]!);
    expect(record.note).toContain('[REDACTED]');
    expect(record.note).not.toContain('kh_abcdef123456');
  });

  it('redacts secrets embedded in the message string', () => {
    const { logger, lines } = capture();
    logger.info('token is ghp_0123456789abcdefghijklmnopqrstuvwxyz');
    const record = JSON.parse(lines[0]!);
    expect(record.msg).toContain('[REDACTED]');
    expect(record.msg).not.toContain('ghp_');
  });

  it('child loggers merge bindings', () => {
    const { logger, lines } = capture();
    logger.child({ orgId: 'o1' }).info('scoped');
    const record = JSON.parse(lines[0]!);
    expect(record.orgId).toBe('o1');
    expect(record.service).toBe('test');
  });

  it('redactValue handles nested structures and cycles', () => {
    const cyclic: Record<string, unknown> = { token: 'secret' };
    cyclic.self = cyclic;
    const out = redactValue(cyclic) as Record<string, unknown>;
    expect(out.token).toBe('[REDACTED]');
    expect(out.self).toBe('[Circular]');
  });
});
