import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { loadApiEnv } from '../src/config/env';

const env = loadApiEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  RATE_LIMIT_MAX: '3',
  RATE_LIMIT_WINDOW: '1 minute',
});

describe('api app', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ env });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns a valid health payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', service: 'chainsre-api', version: '0.1.0' });
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });

  it('sets baseline security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    // helmet defaults
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('allows a whitelisted CORS origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('rejects a non-whitelisted CORS origin with a clean 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.statusCode).toBe(403);
  });

  it('returns a consistent JSON error for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NotFound', statusCode: 404 });
  });

  it('enforces the rate limit', async () => {
    const url = '/health';
    // env sets max=3 within the window.
    await app.inject({ method: 'GET', url });
    await app.inject({ method: 'GET', url });
    await app.inject({ method: 'GET', url });
    const limited = await app.inject({ method: 'GET', url });
    expect(limited.statusCode).toBe(429);
  });
});
