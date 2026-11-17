import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { availabilityRules, blockedSlots } from '../../db/schema/availability.js';
import { bookings } from '../../db/schema/bookings.js';

export function listRulesForProvider(db: Database, providerId: string) {
  return db.query.availabilityRules.findMany({
    where: eq(availabilityRules.providerId, providerId),
  });
}

export function listBlockedRangesInWindow(db: Database, providerId: string, from: Date, to: Date) {
  return db.query.blockedSlots.findMany({
    where: and(
      eq(blockedSlots.providerId, providerId),
      lt(blockedSlots.startsAt, to),
      gt(blockedSlots.endsAt, from),
    ),
  });
}

export function listConfirmedBookingsInWindow(
  db: Database,
  providerId: string,
  from: Date,
  to: Date,
) {
  return db.query.bookings.findMany({
    where: and(
      eq(bookings.providerId, providerId),
      eq(bookings.status, 'confirmed'),
      lt(bookings.startsAt, to),
      gt(bookings.endsAt, from),
    ),
  });
}
