import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function registerProvider(app: App, overrides: Partial<{ email: string }> = {}) {
  const email = overrides.email ?? uniqueEmail();
  const res = await request(app.server)
    .post('/auth/register')
    .send({ email, password: 'a-good-password', role: 'provider' });
  return res.body as { accessToken: string; user: { id: string } };
}

async function registerCustomer(app: App) {
  const res = await request(app.server)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'a-good-password', role: 'customer' });
  return res.body as { accessToken: string };
}

describe('providers', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /providers', () => {
    it('creates a provider profile for the authenticated provider', async () => {
      const { accessToken } = await registerProvider(app);

      const res = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Jane Smith',
          bio: 'Math tutor',
          timezone: 'America/New_York',
          sessionLengthMinutes: 45,
          priceCents: 7500,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Jane Smith',
        bio: 'Math tutor',
        timezone: 'America/New_York',
        sessionLengthMinutes: 45,
        priceCents: 7500,
      });
      expect(res.body.id).toBeTruthy();
    });

    it('rejects a second profile for the same provider with 409', async () => {
      const { accessToken } = await registerProvider(app);
      const payload = {
        name: 'Jane Smith',
        timezone: 'UTC',
        sessionLengthMinutes: 30,
        priceCents: 5000,
      };

      await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(201);

      const res = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(409);
      expect(res.body.error.code).toBe('PROVIDER_PROFILE_EXISTS');
    });

    it('rejects a customer trying to create a provider profile', async () => {
      const { accessToken } = await registerCustomer(app);

      const res = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'X', timezone: 'UTC', sessionLengthMinutes: 30, priceCents: 1000 })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.server)
        .post('/providers')
        .send({ name: 'X', timezone: 'UTC', sessionLengthMinutes: 30, priceCents: 1000 })
        .expect(401);
    });

    it('rejects an invalid IANA timezone', async () => {
      const { accessToken } = await registerProvider(app);

      const res = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'X', timezone: 'Mars/Phobos', sessionLengthMinutes: 30, priceCents: 1000 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a negative price', async () => {
      const { accessToken } = await registerProvider(app);

      await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'X', timezone: 'UTC', sessionLengthMinutes: 30, priceCents: -100 })
        .expect(400);
    });
  });

  describe('PATCH /providers/me', () => {
    it('updates fields on the caller own profile', async () => {
      const { accessToken } = await registerProvider(app);
      await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Old Name', timezone: 'UTC', sessionLengthMinutes: 30, priceCents: 1000 });

      const res = await request(app.server)
        .patch('/providers/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'New Name', priceCents: 2000 })
        .expect(200);

      expect(res.body.name).toBe('New Name');
      expect(res.body.priceCents).toBe(2000);
      expect(res.body.timezone).toBe('UTC');
    });

    it('returns 404 if the provider has no profile yet', async () => {
      const { accessToken } = await registerProvider(app);

      const res = await request(app.server)
        .patch('/providers/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'New Name' })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /providers and /providers/:id', () => {
    it('lists providers with pagination metadata', async () => {
      const { accessToken } = await registerProvider(app);
      await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Listed Provider',
          timezone: 'UTC',
          sessionLengthMinutes: 30,
          priceCents: 1000,
        });

      const res = await request(app.server).get('/providers?pageSize=1&page=1').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 1 });
      expect(res.body.pagination.total).toBeGreaterThan(0);
    });

    it('filters by search and price range', async () => {
      const { accessToken } = await registerProvider(app);
      const uniqueName = `Searchable-${randomUUID()}`;
      await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: uniqueName, timezone: 'UTC', sessionLengthMinutes: 30, priceCents: 9999 });

      const res = await request(app.server)
        .get(
          `/providers?search=${encodeURIComponent(uniqueName)}&minPriceCents=9999&maxPriceCents=9999`,
        )
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe(uniqueName);
    });

    it('gets a provider by id', async () => {
      const { accessToken } = await registerProvider(app);
      const createRes = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Detail Provider',
          timezone: 'UTC',
          sessionLengthMinutes: 30,
          priceCents: 1000,
        });

      const res = await request(app.server).get(`/providers/${createRes.body.id}`).expect(200);
      expect(res.body.name).toBe('Detail Provider');
    });

    it('returns 404 for an unknown provider id', async () => {
      const res = await request(app.server).get(`/providers/${randomUUID()}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
