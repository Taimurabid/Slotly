import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Defaults so `npm test` works with the docker-compose test database out of the box.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://slotly:slotly@localhost:5433/slotly_test',
      JWT_ACCESS_SECRET: 'test-secret-that-is-definitely-at-least-32-chars',
      // High enough that a full test run never trips the auth rate limit
      // itself; the rate-limit behavior is tested with its own low value.
      RATE_LIMIT_AUTH_MAX: '1000',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/db/migrations/**'],
    },
  },
});
