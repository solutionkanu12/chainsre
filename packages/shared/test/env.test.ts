import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EnvValidationError,
  parseEnv,
  zBool,
  zChainId,
  zCsv,
  zHttpUrl,
  zLogLevel,
  zPort,
} from '../src/env';

describe('env', () => {
  const schema = z.object({
    LOG_LEVEL: zLogLevel,
    PORT: zPort,
    CHAIN_ID: zChainId,
    ORIGINS: zCsv,
    API_URL: zHttpUrl,
    DEBUG: zBool,
  });

  it('parses a valid environment', () => {
    const parsed = parseEnv(schema, {
      source: {
        LOG_LEVEL: 'info',
        PORT: '8080',
        CHAIN_ID: '84532',
        ORIGINS: 'http://localhost:3000, https://example.com',
        API_URL: 'http://localhost:8080',
        DEBUG: 'true',
      },
    });
    expect(parsed).toEqual({
      LOG_LEVEL: 'info',
      PORT: 8080,
      CHAIN_ID: 84532,
      ORIGINS: ['http://localhost:3000', 'https://example.com'],
      API_URL: 'http://localhost:8080',
      DEBUG: true,
    });
  });

  it('throws EnvValidationError listing every problem', () => {
    try {
      parseEnv(schema, {
        source: {
          LOG_LEVEL: 'loud',
          PORT: '70000',
          CHAIN_ID: '999999',
          ORIGINS: 'ok',
          API_URL: 'not-a-url',
          DEBUG: 'maybe',
        },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issues = (err as EnvValidationError).issues;
      expect(issues.some((i) => i.startsWith('LOG_LEVEL'))).toBe(true);
      expect(issues.some((i) => i.startsWith('PORT'))).toBe(true);
      expect(issues.some((i) => i.startsWith('CHAIN_ID'))).toBe(true);
      expect(issues.some((i) => i.startsWith('API_URL'))).toBe(true);
      expect(issues.some((i) => i.startsWith('DEBUG'))).toBe(true);
    }
  });

  it('zChainId rejects unsupported chains', () => {
    expect(() => zChainId.parse('1234')).toThrow();
    expect(zChainId.parse('84532')).toBe(84532);
  });

  it('zCsv trims and drops empty entries', () => {
    expect(zCsv.parse('a, ,b,  , c')).toEqual(['a', 'b', 'c']);
  });
});
