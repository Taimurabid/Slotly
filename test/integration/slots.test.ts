import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function setUpProvider(app: App, overrides: Partial<{ sessionLengthMinutes: number }> = {}) {
  const registerRes = await request(app.server)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'a-good-password', role: 'provider' });
  const accessToken = registerRes.body.accessToken as string;

  const profileRes = await request(app.server)
    .post('/providers')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: 'Slot Provider',
      timezone: 'UTC',
      sessionLengthMinutes: overrides.sessionLengthMinutes ?? 60,
      priceCents: 1000,
    });

  return { accessToken, providerId: profileRes.body.id as string };
}

describe('GET /providers/:id/slots', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns open slots computed from the weekly rule', async () => {
    const { accessToken, providerId } = await setUpProvider(app);

    await request(app.server)
      .post('/providers/me/availability-rules')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }); // Monday 9-11 UTC

    const res = await request(app.server)
      .get(`/providers/${providerId}/slots`)
      .query({ from: '2027-03-08T00:00:00Z', to: '2027-03-09T00:00:00Z' })
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      startsAt: '2027-03-08T09:00:00.000Z',
      endsAt: '2027-03-08T10:00:00.000Z',
    });
  });

  it('returns an empty list for a provider with no availability rules', async () => {
    const { providerId } = await setUpProvider(app);

    const res = await request(app.server)
      .get(`/providers/${providerId}/slots`)
      .query({ from: '2027-03-08T00:00:00Z', to: '2027-03-09T00:00:00Z' })
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('404s for an unknown provider', async () => {
    const res = await request(app.server)
      .get(`/providers/${randomUUID()}/slots`)
      .query({ from: '2027-03-08T00:00:00Z', to: '2027-03-09T00:00:00Z' })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects from after to with a validation error', async () => {
    const { providerId } = await setUpProvider(app);

    const res = await request(app.server)
      .get(`/providers/${providerId}/slots`)
      .query({ from: '2027-03-09T00:00:00Z', to: '2027-03-08T00:00:00Z' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a range longer than 90 days', async () => {
    const { providerId } = await setUpProvider(app);

    const res = await request(app.server)
      .get(`/providers/${providerId}/slots`)
      .query({ from: '2027-01-01T00:00:00Z', to: '2027-12-31T00:00:00Z' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('excludes slots covered by a one-off blocked range', async () => {
    const { accessToken, providerId } = await setUpProvider(app);

    await request(app.server)
      .post('/providers/me/availability-rules')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 });

    await request(app.server)
      .post('/providers/me/blocked-slots')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ startsAt: '2027-03-07T00:00:00Z', endsAt: '2027-03-09T00:00:00Z' });

    const res = await request(app.server)
      .get(`/providers/${providerId}/slots`)
      .query({ from: '2027-03-08T00:00:00Z', to: '2027-03-09T00:00:00Z' })
      .expect(200);

    expect(res.body).toEqual([]);
  });
});
