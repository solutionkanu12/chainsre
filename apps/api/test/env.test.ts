import { describe, expect, it } from 'vitest';

import { loadApiEnv } from '../src/config/env';

describe('api env', () => {
  it('applies safe defaults', () => {
    const env = loadApiEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_HOST).toBe('0.0.0.0');
    expect(env.API_PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.RATE_LIMIT_MAX).toBe(100);
    expect(env.BODY_LIMIT_BYTES).toBe(1_048_576);
  });

  it('parses a comma-separated CORS allowlist', () => {
    const env = loadApiEnv({
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com',
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('rejects an invalid port', () => {
    expect(() => loadApiEnv({ API_PORT: '0' })).toThrow();
    expect(() => loadApiEnv({ API_PORT: '99999' })).toThrow();
  });

  it('rejects an invalid Supabase URL', () => {
    expect(() => loadApiEnv({ SUPABASE_URL: 'not-a-url' })).toThrow();
  });
});
