import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { providerProfiles } from './providers.js';

/**
 * A weekly recurring rule, e.g. "Monday 09:00-13:00". Start/end are stored as
 * minutes-from-midnight in the provider's own timezone, not as UTC instants,
 * because the rule itself is a wall-clock pattern ("every Monday at 9am
 * local") that repeats indefinitely. Converting a rule into concrete UTC
 * instants only makes sense once you pick an actual calendar date, which is
 * where DST is resolved (slot computation, step 5) - a fixed UTC offset
 * stored here would be wrong half the year for timezones that observe DST.
 */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    // 0 = Sunday ... 6 = Saturday, matching JS Date#getDay().
    dayOfWeek: smallint('day_of_week').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('day_of_week_range', sql`${table.dayOfWeek} between 0 and 6`),
    check('start_before_end', sql`${table.startMinute} < ${table.endMinute}`),
    check('minute_of_day_range', sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440`),
    index('availability_rules_provider_idx').on(table.providerId),
  ],
);

/**
 * A one-off block, e.g. a provider's vacation day. Unlike a recurring rule,
 * this refers to one concrete span of time, so it is stored as an absolute
 * UTC range (`starts_at`/`ends_at` are timestamptz) rather than local
 * wall-clock minutes.
 */
export const blockedSlots = pgTable(
  'blocked_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('blocked_starts_before_ends', sql`${table.startsAt} < ${table.endsAt}`),
    index('blocked_slots_provider_idx').on(table.providerId, table.startsAt),
  ],
);

export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type NewAvailabilityRule = typeof availabilityRules.$inferInsert;
export type BlockedSlot = typeof blockedSlots.$inferSelect;
export type NewBlockedSlot = typeof blockedSlots.$inferInsert;
