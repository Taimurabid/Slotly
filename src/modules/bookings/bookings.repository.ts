import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { bookings, type Booking, type NewBooking } from '../../db/schema/bookings.js';

export async function insertBooking(db: Database, values: NewBooking): Promise<Booking> {
  const [row] = await db.insert(bookings).values(values).returning();
  if (!row) throw new Error('Insert into bookings returned no row');
  return row;
}

export function findBookingById(db: Database, id: string): Promise<Booking | undefined> {
  return db.query.bookings.findFirst({ where: eq(bookings.id, id) });
}

/**
 * Scoped to `id`, `customerId`, and `status = 'confirmed'` in the WHERE
 * clause itself, not just checked beforehand in application code - so a
 * caller genuinely cannot cancel a booking that isn't theirs or that was
 * already cancelled, no matter what the preceding service-layer checks say.
 */
export async function cancelBookingById(
  db: Database,
  id: string,
  customerId: string,
): Promise<Booking | undefined> {
  const [row] = await db
    .update(bookings)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(bookings.id, id),
        eq(bookings.customerId, customerId),
        eq(bookings.status, 'confirmed'),
      ),
    )
    .returning();
  return row;
}

export interface BookingListFilter {
  status?: 'confirmed' | 'cancelled';
  sortOrder: 'asc' | 'desc';
  limit: number;
  offset: number;
}

async function listBookings(
  db: Database,
  ownerCondition: SQL,
  filter: BookingListFilter,
): Promise<{ rows: Booking[]; total: number }> {
  const conditions = filter.status
    ? and(ownerCondition, eq(bookings.status, filter.status))
    : ownerCondition;
  const orderFn = filter.sortOrder === 'asc' ? asc : desc;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(bookings)
      .where(conditions)
      .orderBy(orderFn(bookings.startsAt))
      .limit(filter.limit)
      .offset(filter.offset),
    db.select({ value: count() }).from(bookings).where(conditions),
  ]);
  return { rows, total: totalRows[0]?.value ?? 0 };
}

export function listBookingsForCustomer(
  db: Database,
  customerId: string,
  filter: BookingListFilter,
): Promise<{ rows: Booking[]; total: number }> {
  return listBookings(db, eq(bookings.customerId, customerId), filter);
}

export function listBookingsForProvider(
  db: Database,
  providerId: string,
  filter: BookingListFilter,
): Promise<{ rows: Booking[]; total: number }> {
  return listBookings(db, eq(bookings.providerId, providerId), filter);
}
