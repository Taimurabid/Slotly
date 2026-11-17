import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { verifyCredentials } from '../../src/modules/auth/auth.service.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

const CORRECT_PASSWORD = 'a-good-password';
const WRONG_PASSWORD = 'definitely-the-wrong-password';

describe('account lockout (SEC-04)', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('locks the account after 5 consecutive failed logins, even with the correct password on the 6th attempt', async () => {
    const email = uniqueEmail();
    await request(app.server)
      .post('/auth/register')
      .send({ email, password: CORRECT_PASSWORD, role: 'customer' });

    for (let i = 0; i < 5; i++) {
      const res = await request(app.server)
        .post('/auth/login')
        .send({ email, password: WRONG_PASSWORD })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }

    // Locked now - even the correct password is rejected, with the exact
    // same message as a wrong password, so a locked account can't be
    // distinguished from one that's merely rejecting a bad password.
    const res = await request(app.server)
      .post('/auth/login')
      .send({ email, password: CORRECT_PASSWORD })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });

  it('a successful login resets the failed-attempt counter', async () => {
    const email = uniqueEmail();
    await request(app.server)
      .post('/auth/register')
      .send({ email, password: CORRECT_PASSWORD, role: 'customer' });

    // 2 failures, then a success - should not count toward the threshold.
    for (let i = 0; i < 2; i++) {
      await request(app.server).post('/auth/login').send({ email, password: WRONG_PASSWORD });
    }
    await request(app.server)
      .post('/auth/login')
      .send({ email, password: CORRECT_PASSWORD })
      .expect(200);

    // 4 more failures (not 5) should not lock it, since the counter reset.
    for (let i = 0; i < 4; i++) {
      await request(app.server).post('/auth/login').send({ email, password: WRONG_PASSWORD });
    }
    await request(app.server)
      .post('/auth/login')
      .send({ email, password: CORRECT_PASSWORD })
      .expect(200);
  });

  it('unlocks automatically once the lockout window has passed', async () => {
    const email = uniqueEmail();
    await request(app.server)
      .post('/auth/register')
      .send({ email, password: CORRECT_PASSWORD, role: 'customer' });

    for (let i = 0; i < 5; i++) {
      await request(app.server).post('/auth/login').send({ email, password: WRONG_PASSWORD });
    }
    await request(app.server)
      .post('/auth/login')
      .send({ email, password: CORRECT_PASSWORD })
      .expect(401);

    // Calling the service directly with an injected `now` 16 minutes in the
    // future, rather than waiting 15 real minutes for the lockout to expire.
    const sixteenMinutesLater = new Date(Date.now() + 16 * 60 * 1000);
    const user = await verifyCredentials(app.db, email, CORRECT_PASSWORD, sixteenMinutesLater);
    expect(user.email).toBe(email);
  });

  it('does not lock an account that never existed, and gives the same error', async () => {
    const res = await request(app.server)
      .post('/auth/login')
      .send({ email: uniqueEmail(), password: WRONG_PASSWORD })
      .expect(401);
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });
});
