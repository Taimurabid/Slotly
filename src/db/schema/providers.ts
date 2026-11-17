import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * One profile per provider user. `timezone` is an IANA name (e.g.
 * "America/New_York"), not a UTC offset, because offsets change with DST and
 * a fixed offset would silently drift twice a year.
 */
export const providerProfiles = pgTable(
  'provider_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bio: text('bio'),
    timezone: text('timezone').notNull(),
    sessionLengthMinutes: integer('session_length_minutes').notNull(),
    priceCents: integer('price_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('session_length_positive', sql`${table.sessionLengthMinutes} > 0`),
    check('price_not_negative', sql`${table.priceCents} >= 0`),
  ],
);

export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type NewProviderProfile = typeof providerProfiles.$inferInsert;
