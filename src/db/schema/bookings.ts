import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { providerProfiles } from './providers.js';
import { users } from './users.js';

export const bookingStatusEnum = pgEnum('booking_status', ['confirmed', 'cancelled']);

/**
 * The exclusion constraint that actually prevents double-booking lives in a
 * hand-written SQL migration (see src/db/migrations), not here, because
 * Drizzle's schema builder has no first-class API for `EXCLUDE USING gist`.
 * It only applies to confirmed bookings, so cancelling frees the slot.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: bookingStatusEnum('status').notNull().default('confirmed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('booking_starts_before_ends', sql`${table.startsAt} < ${table.endsAt}`),
    index('bookings_provider_idx').on(table.providerId, table.startsAt),
    index('bookings_customer_idx').on(table.customerId, table.startsAt),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
