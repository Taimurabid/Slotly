import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function registerProviderWithProfile(app: App) {
  const email = uniqueEmail();
  const registerRes = await request(app.server)
    .post('/auth/register')
    .send({ email, password: 'a-good-password', role: 'provider' });
  const accessToken = registerRes.body.accessToken as string;

  const profileRes = await request(app.server)
    .post('/providers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Provider', timezone: 'UTC', sessionLengthMinutes: 30, priceCents: 1000 });

  return { accessToken, providerId: profileRes.body.id as string };
}

describe('availability', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('availability rules', () => {
    it('adds and lists a weekly recurring rule', async () => {
      const { accessToken, providerId } = await registerProviderWithProfile(app);

      const createRes = await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ dayOfWeek: 1, startMinute: 540, endMinute: 780 })
        .expect(201);
      expect(createRes.body).toMatchObject({ dayOfWeek: 1, startMinute: 540, endMinute: 780 });

      const listRes = await request(app.server)
        .get(`/providers/${providerId}/availability-rules`)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(createRes.body.id);
    });

    it('rejects a rule where startMinute is not before endMinute', async () => {
      const { accessToken } = await registerProviderWithProfile(app);

      const res = await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ dayOfWeek: 1, startMinute: 780, endMinute: 540 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('404s when creating a rule before a provider profile exists', async () => {
      const email = uniqueEmail();
      const registerRes = await request(app.server)
        .post('/auth/register')
        .send({ email, password: 'a-good-password', role: 'provider' });
      const accessToken = registerRes.body.accessToken as string;

      const res = await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ dayOfWeek: 1, startMinute: 540, endMinute: 780 })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('deletes a rule owned by the caller', async () => {
      const { accessToken, providerId } = await registerProviderWithProfile(app);
      const createRes = await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ dayOfWeek: 2, startMinute: 0, endMinute: 60 });

      await request(app.server)
        .delete(`/providers/me/availability-rules/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const listRes = await request(app.server)
        .get(`/providers/${providerId}/availability-rules`)
        .expect(200);
      expect(listRes.body).toHaveLength(0);
    });

    it("does not allow one provider to delete another provider's rule", async () => {
      const providerA = await registerProviderWithProfile(app);
      const providerB = await registerProviderWithProfile(app);

      const ruleRes = await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${providerA.accessToken}`)
        .send({ dayOfWeek: 3, startMinute: 0, endMinute: 60 });

      const res = await request(app.server)
        .delete(`/providers/me/availability-rules/${ruleRes.body.id}`)
        .set('Authorization', `Bearer ${providerB.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('blocked slots', () => {
    it('adds and lists a one-off blocked range', async () => {
      const { accessToken, providerId } = await registerProviderWithProfile(app);

      const createRes = await request(app.server)
        .post('/providers/me/blocked-slots')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          startsAt: '2026-03-01T00:00:00Z',
          endsAt: '2026-03-02T00:00:00Z',
          reason: 'Vacation',
        })
        .expect(201);
      expect(createRes.body.reason).toBe('Vacation');

      const listRes = await request(app.server)
        .get(`/providers/${providerId}/blocked-slots`)
        .expect(200);
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.pagination.total).toBe(1);
    });

    it('rejects a range where startsAt is not before endsAt', async () => {
      const { accessToken } = await registerProviderWithProfile(app);

      const res = await request(app.server)
        .post('/providers/me/blocked-slots')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ startsAt: '2026-03-02T00:00:00Z', endsAt: '2026-03-01T00:00:00Z' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deletes a blocked range owned by the caller', async () => {
      const { accessToken, providerId } = await registerProviderWithProfile(app);
      const createRes = await request(app.server)
        .post('/providers/me/blocked-slots')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ startsAt: '2026-04-01T00:00:00Z', endsAt: '2026-04-02T00:00:00Z' });

      await request(app.server)
        .delete(`/providers/me/blocked-slots/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const listRes = await request(app.server)
        .get(`/providers/${providerId}/blocked-slots`)
        .expect(200);
      expect(listRes.body.data).toHaveLength(0);
    });
  });
});
