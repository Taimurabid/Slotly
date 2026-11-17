import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

describe('auth rate limiting', () => {
  let app: App;

  beforeAll(async () => {
    // A separate app instance with a deliberately low limit, so this test
    // doesn't need to send hundreds of requests to prove the limit works.
    app = await buildApp(loadEnv({ ...process.env, RATE_LIMIT_AUTH_MAX: '3' }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after exceeding the per-minute limit on an auth route', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.server).post('/auth/login').send({ email: 'x@example.com', password: 'x' });
    }

    const res = await request(app.server)
      .post('/auth/login')
      .send({ email: 'x@example.com', password: 'x' })
      .expect(429);

    expect(res.body.error).toBeTruthy();
  });

  it('does not rate limit unrelated routes under the same limit', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.server).get('/health').expect(200);
    }
  });
});
