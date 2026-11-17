import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeToSeed } from '../../src/db/seed.js';

describe('assertSafeToSeed (SEC-01)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOverride = process.env.ALLOW_SEED_DESTRUCTIVE_RESET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ALLOW_SEED_DESTRUCTIVE_RESET = originalOverride;
  });

  it('throws when NODE_ENV is production and no override is set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_SEED_DESTRUCTIVE_RESET;
    expect(() => assertSafeToSeed()).toThrow(/Refusing to run the seed script/);
  });

  it('does not throw when NODE_ENV is production and the override is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_SEED_DESTRUCTIVE_RESET = 'true';
    expect(() => assertSafeToSeed()).not.toThrow();
  });

  it('does not throw outside production regardless of the override', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_SEED_DESTRUCTIVE_RESET;
    expect(() => assertSafeToSeed()).not.toThrow();

    process.env.NODE_ENV = 'test';
    expect(() => assertSafeToSeed()).not.toThrow();
  });

  it('is case-sensitive about the override value (only the literal "true" counts)', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_SEED_DESTRUCTIVE_RESET = 'TRUE';
    expect(() => assertSafeToSeed()).toThrow();
  });
});
