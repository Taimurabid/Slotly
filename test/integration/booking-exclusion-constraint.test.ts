import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { bookings } from '../../src/db/schema/bookings.js';
import { providerProfiles } from '../../src/db/schema/providers.js';
import { users } from '../../src/db/schema/users.js';

/** pg wraps the real Postgres error (with its `constraint` name) in `.cause`. */
async function constraintViolated(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = err instanceof Error ? err.cause : undefined;
    return cause && typeof cause === 'object' && 'constraint' in cause
      ? String(cause.constraint)
      : undefined;
  }
}

/**
 * This is a direct, non-concurrent proof that the database itself (not just
 * application code) refuses an overlapping booking. The full concurrent
 * double-booking test, which fires simultaneous HTTP requests, is added in
 * the bookings module once the booking service exists.
 */
describe('bookings_no_overlap exclusion constraint', () => {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? '');
  let providerId: string;

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `provider-${randomUUID()}@example.com`,
        passwordHash: 'irrelevant',
        role: 'provider',
      })
      .returning({ id: users.id });
    if (!user) throw new Error('failed to insert test user');

    const [provider] = await db
      .insert(providerProfiles)
      .values({
        userId: user.id,
        name: 'Test Provider',
        timezone: 'UTC',
        sessionLengthMinutes: 30,
        priceCents: 5000,
      })
      .returning({ id: providerProfiles.id });
    if (!provider) throw new Error('failed to insert test provider');
    providerId = provider.id;
  });

  async function bookCustomer(startsAt: string, endsAt: string) {
    const [customer] = await db
      .insert(users)
      .values({
        email: `customer-${randomUUID()}@example.com`,
        passwordHash: 'irrelevant',
        role: 'customer',
      })
      .returning({ id: users.id });
    if (!customer) throw new Error('failed to insert test customer');

    return db.insert(bookings).values({
      providerId,
      customerId: customer.id,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
    });
  }

  it('allows a booking for an open slot', async () => {
    await expect(
      bookCustomer('2026-02-01T10:00:00Z', '2026-02-01T10:30:00Z'),
    ).resolves.not.toThrow();
  });

  it('rejects a booking that overlaps an existing one for the same provider', async () => {
    await bookCustomer('2026-02-02T10:00:00Z', '2026-02-02T10:30:00Z');

    const constraint = await constraintViolated(
      bookCustomer('2026-02-02T10:15:00Z', '2026-02-02T10:45:00Z'),
    );
    expect(constraint).toBe('bookings_no_overlap');
  });

  it('allows back-to-back bookings that touch but do not overlap', async () => {
    await bookCustomer('2026-02-03T10:00:00Z', '2026-02-03T10:30:00Z');

    await expect(
      bookCustomer('2026-02-03T10:30:00Z', '2026-02-03T11:00:00Z'),
    ).resolves.not.toThrow();
  });

  it('rejects a start-before-end booking via the check constraint', async () => {
    const constraint = await constraintViolated(
      bookCustomer('2026-02-04T10:30:00Z', '2026-02-04T10:00:00Z'),
    );
    expect(constraint).toBe('booking_starts_before_ends');
  });
});
