import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function registerWithRole(app: App, role: 'provider' | 'customer') {
  const res = await request(app.server)
    .post('/auth/register')
    .send({ email: uniqueEmail(), password: 'a-good-password', role });
  return {
    accessToken: res.body.accessToken as string,
    userId: res.body.user.id as string,
  };
}

async function setUpProviderWithRule(
  app: App,
  overrides: Partial<{ dayOfWeek: number; startMinute: number; endMinute: number }> = {},
) {
  const provider = await registerWithRole(app, 'provider');
  const profileRes = await request(app.server)
    .post('/providers')
    .set('Authorization', `Bearer ${provider.accessToken}`)
    .send({
      name: 'Booking Provider',
      timezone: 'UTC',
      sessionLengthMinutes: 30,
      priceCents: 1000,
    });
  const providerId = profileRes.body.id as string;

  await request(app.server)
    .post('/providers/me/availability-rules')
    .set('Authorization', `Bearer ${provider.accessToken}`)
    .send({
      dayOfWeek: overrides.dayOfWeek ?? 1, // Monday
      startMinute: overrides.startMinute ?? 9 * 60,
      endMinute: overrides.endMinute ?? 10 * 60,
    });

  return { ...provider, providerId };
}

// A far-future Monday (today in this environment is well before this), so
// slots there are never filtered out as "already in the past".
const FUTURE_MONDAY_SLOT = '2027-03-08T09:00:00Z';

describe('bookings', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /bookings', () => {
    it('books an open slot', async () => {
      const { providerId } = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(201);

      expect(res.body).toMatchObject({
        providerId,
        customerId: customer.userId,
        startsAt: '2027-03-08T09:00:00.000Z',
        endsAt: '2027-03-08T09:30:00.000Z',
        status: 'confirmed',
      });
    });

    it('rejects a second booking for the same slot with 409', async () => {
      const { providerId } = await setUpProviderWithRule(app);
      const customerA = await registerWithRole(app, 'customer');
      const customerB = await registerWithRole(app, 'customer');

      await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerA.accessToken}`)
        .send({ providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(201);

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .send({ providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(409);
      expect(res.body.error.code).toBe('SLOT_NOT_AVAILABLE');
    });

    it('rejects a time outside the provider availability rules', async () => {
      const { providerId } = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId, startsAt: '2027-03-08T20:00:00Z' }) // outside 9-10 window
        .expect(409);
      expect(res.body.error.code).toBe('SLOT_NOT_AVAILABLE');
    });

    it('rejects a time that overlaps a blocked range', async () => {
      const provider = await setUpProviderWithRule(app);
      await request(app.server)
        .post('/providers/me/blocked-slots')
        .set('Authorization', `Bearer ${provider.accessToken}`)
        .send({ startsAt: '2027-03-07T00:00:00Z', endsAt: '2027-03-09T00:00:00Z' });
      const customer = await registerWithRole(app, 'customer');

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(409);
      expect(res.body.error.code).toBe('SLOT_NOT_AVAILABLE');
    });

    it('rejects a time in the past', async () => {
      const { providerId } = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId, startsAt: '2020-01-06T09:00:00Z' })
        .expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects an unknown provider', async () => {
      const customer = await registerWithRole(app, 'customer');

      const res = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: randomUUID(), startsAt: FUTURE_MONDAY_SLOT })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects a provider trying to book (only customers can)', async () => {
      const { providerId, accessToken } = await setUpProviderWithRule(app);

      await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(403);
    });
  });

  describe('GET /bookings/me and GET /providers/me/bookings', () => {
    it('lists the booking for the customer who made it and for the owning provider', async () => {
      const provider = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(201);

      const customerRes = await request(app.server)
        .get('/bookings/me')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(customerRes.body.data).toHaveLength(1);
      expect(customerRes.body.data[0].providerId).toBe(provider.providerId);

      const providerRes = await request(app.server)
        .get('/providers/me/bookings')
        .set('Authorization', `Bearer ${provider.accessToken}`)
        .expect(200);
      expect(providerRes.body.data).toHaveLength(1);
      expect(providerRes.body.data[0].customerId).toBe(customer.userId);
    });

    it('does not show one customer bookings to another customer', async () => {
      const provider = await setUpProviderWithRule(app);
      const customerA = await registerWithRole(app, 'customer');
      const customerB = await registerWithRole(app, 'customer');

      await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerA.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT });

      const res = await request(app.server)
        .get('/bookings/me')
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('filters by status', async () => {
      const provider = await setUpProviderWithRule(app, {
        startMinute: 9 * 60,
        endMinute: 11 * 60,
      });
      const customer = await registerWithRole(app, 'customer');

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: '2027-03-08T10:00:00Z' });

      await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`);

      const confirmedRes = await request(app.server)
        .get('/bookings/me?status=confirmed')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      const confirmedData = confirmedRes.body.data as Array<{ status: string }>;
      expect(confirmedData.every((b) => b.status === 'confirmed')).toBe(true);

      const cancelledRes = await request(app.server)
        .get('/bookings/me?status=cancelled')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(cancelledRes.body.data).toHaveLength(1);
      expect(cancelledRes.body.data[0].id).toBe(bookRes.body.id);
    });
  });

  describe('POST /bookings/:id/cancel', () => {
    it('cancels a booking more than 24 hours before its start', async () => {
      const provider = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT });

      const res = await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('frees the slot for another customer once cancelled', async () => {
      const provider = await setUpProviderWithRule(app);
      const customerA = await registerWithRole(app, 'customer');
      const customerB = await registerWithRole(app, 'customer');

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerA.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT });

      await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customerA.accessToken}`)
        .expect(200);

      await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT })
        .expect(201);
    });

    it('rejects cancelling someone else booking with 404', async () => {
      const provider = await setUpProviderWithRule(app);
      const customerA = await registerWithRole(app, 'customer');
      const customerB = await registerWithRole(app, 'customer');

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customerA.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT });

      const res = await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customerB.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      const provider = await setUpProviderWithRule(app);
      const customer = await registerWithRole(app, 'customer');

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ providerId: provider.providerId, startsAt: FUTURE_MONDAY_SLOT });

      await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      const res = await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('ALREADY_CANCELLED');
    });

    it('rejects cancelling within 24 hours of the start time', async () => {
      const customer = await registerWithRole(app, 'customer');

      // Book a slot that starts soon (relative to the real clock) by giving
      // this provider a rule covering right now through a few hours out.
      const now = new Date();
      const soonStart = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
      // Generated slots always land exactly on a minute boundary; align to
      // that so the requested startsAt matches one exactly.
      soonStart.setUTCSeconds(0, 0);
      const dayOfWeek = soonStart.getUTCDay();
      const startMinute = soonStart.getUTCHours() * 60 + soonStart.getUTCMinutes();

      const soonProviderReg = await registerWithRole(app, 'provider');
      const profileRes = await request(app.server)
        .post('/providers')
        .set('Authorization', `Bearer ${soonProviderReg.accessToken}`)
        .send({
          name: 'Soon Provider',
          timezone: 'UTC',
          sessionLengthMinutes: 30,
          priceCents: 1000,
        });
      const soonProviderId = profileRes.body.id as string;
      await request(app.server)
        .post('/providers/me/availability-rules')
        .set('Authorization', `Bearer ${soonProviderReg.accessToken}`)
        .send({ dayOfWeek, startMinute, endMinute: startMinute + 30 });

      const bookRes = await request(app.server)
        .post('/bookings')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          providerId: soonProviderId,
          startsAt: new Date(soonStart.getTime()).toISOString(),
        })
        .expect(201);

      const res = await request(app.server)
        .post(`/bookings/${bookRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('CANCELLATION_WINDOW_PASSED');
    });
  });
});
