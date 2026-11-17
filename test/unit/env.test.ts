import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('parses comma-separated CORS origins', () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: 'https://a.com, https://b.com' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('rejects a short JWT secret with a readable message', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects a wildcard CORS origin (SEC-02)', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS must not include/);
  });

  it('rejects a wildcard mixed in with real origins', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: 'https://a.com,*' })).toThrow(
      /CORS_ORIGINS must not include/,
    );
  });

  it('still accepts a normal list of real origins', () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: 'https://a.com,https://b.com' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });
});
