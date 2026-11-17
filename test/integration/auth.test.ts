import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('auth', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('creates an account and returns tokens', async () => {
      const email = uniqueEmail();
      const res = await request(app.server)
        .post('/auth/register')
        .send({ email, password: 'a-good-password', role: 'customer' })
        .expect(201);

      expect(res.body.user).toMatchObject({ email, role: 'customer' });
      expect(res.body.user.id).toBeTruthy();
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail();
      await request(app.server)
        .post('/auth/register')
        .send({ email, password: 'a-good-password', role: 'provider' })
        .expect(201);

      const res = await request(app.server)
        .post('/auth/register')
        .send({ email, password: 'a-different-password', role: 'provider' })
        .expect(409);

      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects an invalid email with a validation error', async () => {
      const res = await request(app.server)
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'a-good-password', role: 'customer' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a short password with a validation error', async () => {
      const res = await request(app.server)
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'short', role: 'customer' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown role with a validation error', async () => {
      const res = await request(app.server)
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'a-good-password', role: 'admin' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    async function registerUser(password: string) {
      const email = uniqueEmail();
      await request(app.server).post('/auth/register').send({ email, password, role: 'customer' });
      return email;
    }

    it('logs in with the correct credentials', async () => {
      const email = await registerUser('correct-password');

      const res = await request(app.server)
        .post('/auth/login')
        .send({ email, password: 'correct-password' })
        .expect(200);

      expect(res.body.user.email).toBe(email);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('rejects the wrong password with 401 and a generic message', async () => {
      const email = await registerUser('correct-password');

      const res = await request(app.server)
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toMatch(/invalid email or password/i);
    });

    it('rejects an unknown email with the same generic message', async () => {
      const res = await request(app.server)
        .post('/auth/login')
        .send({ email: uniqueEmail(), password: 'whatever' })
        .expect(401);

      expect(res.body.error.message).toMatch(/invalid email or password/i);
    });
  });

  describe('POST /auth/refresh', () => {
    async function registerAndGetTokens() {
      const res = await request(app.server)
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'a-good-password', role: 'customer' });
      return res.body as { accessToken: string; refreshToken: string };
    }

    it('exchanges a valid refresh token for a new pair', async () => {
      const { refreshToken } = await registerAndGetTokens();

      const res = await request(app.server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it('rejects a reused (already rotated) refresh token', async () => {
      const { refreshToken } = await registerAndGetTokens();
      await request(app.server).post('/auth/refresh').send({ refreshToken }).expect(200);

      const res = await request(app.server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a garbage refresh token', async () => {
      const res = await request(app.server)
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token so it can no longer be used', async () => {
      const registerRes = await request(app.server)
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'a-good-password', role: 'customer' });
      const { refreshToken } = registerRes.body as { refreshToken: string };

      await request(app.server).post('/auth/logout').send({ refreshToken }).expect(204);

      const res = await request(app.server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('is idempotent: logging out an unknown token still returns 204', async () => {
      await request(app.server)
        .post('/auth/logout')
        .send({ refreshToken: 'never-issued-token' })
        .expect(204);
    });
  });
});
