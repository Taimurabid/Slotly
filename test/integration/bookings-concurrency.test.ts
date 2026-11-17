import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

/**
 * This is the proof that double-booking is impossible even under real
 * concurrency, not just "impossible if requests happen to arrive one at a
 * time." N customers all request the exact same slot at once via
 * Promise.all - genuinely concurrent HTTP requests, each getting its own
 * connection from the pg Pool (default max 10, matching N below so every
 * request can actually run at the same time instead of queueing for a
 * connection).
 *
 * The application-level pre-check in bookings.service.ts (ask slot
 * computation whether the time is open) cannot prevent this race: all N
 * requests read the same "nothing booked yet" state before any of them has
 * written anything. What actually decides the outcome is the
 * `bookings_no_overlap` EXCLUDE constraint in Postgres (see
 * src/db/migrations/0001_bookings_no_overlap_exclusion.sql) - exactly one
 * INSERT is allowed to commit, and the rest fail at the database and
 * surface as 409 SLOT_NOT_AVAILABLE.
 */
describe('concurrent booking requests for the same slot', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(loadEnv());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // argon2 is deliberately expensive, and this test hashes 11 passwords
  // (1 provider + 10 customers) under real concurrent load, so it needs
  // more headroom than vitest's default 5s timeout.
  it('lets exactly one of N simultaneous requests for the same slot succeed', async () => {
    const providerReg = await request(app.server)
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'a-good-password', role: 'provider' });
    const providerToken = providerReg.body.accessToken as string;

    const profileRes = await request(app.server)
      .post('/providers')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        name: 'Concurrency Provider',
        timezone: 'UTC',
        sessionLengthMinutes: 30,
        priceCents: 1000,
      });
    const providerId = profileRes.body.id as string;

    await request(app.server)
      .post('/providers/me/availability-rules')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }); // Monday 9-10 UTC

    const CONCURRENCY = 10;
    const customerTokens = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const res = await request(app.server)
          .post('/auth/register')
          .send({ email: uniqueEmail(), password: 'a-good-password', role: 'customer' });
        return res.body.accessToken as string;
      }),
    );

    const targetStartsAt = '2027-03-08T09:00:00Z'; // a future Monday, inside the 9-10 rule window

    const results = await Promise.all(
      customerTokens.map((token) =>
        request(app.server)
          .post('/bookings')
          .set('Authorization', `Bearer ${token}`)
          .send({ providerId, startsAt: targetStartsAt }),
      ),
    );

    const succeeded = results.filter((res) => res.status === 201);
    const conflicted = results.filter((res) => res.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(CONCURRENCY - 1);
    for (const res of conflicted) {
      expect(res.body.error.code).toBe('SLOT_NOT_AVAILABLE');
    }

    // And the database itself agrees there is exactly one confirmed
    // booking for this slot - not just that the API returned one 201.
    const listRes = await request(app.server)
      .get('/providers/me/bookings?pageSize=100')
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);
    const confirmedForSlot = (
      listRes.body.data as Array<{ startsAt: string; status: string }>
    ).filter((b) => b.startsAt === '2027-03-08T09:00:00.000Z' && b.status === 'confirmed');
    expect(confirmedForSlot).toHaveLength(1);
  }, 20_000);
});
