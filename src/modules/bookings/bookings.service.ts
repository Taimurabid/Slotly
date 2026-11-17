import type { Database } from '../../db/client.js';
import type { Booking } from '../../db/schema/bookings.js';
import { AppError } from '../../lib/errors.js';
import {
  offsetFor,
  paginationMeta,
  type Pagination,
  type PaginationMeta,
} from '../../lib/pagination.js';
import { findProviderById, findProviderByUserId } from '../providers/providers.repository.js';
import { getOpenSlotsForProvider } from '../slots/slots.service.js';
import {
  cancelBookingById,
  findBookingById,
  insertBooking,
  listBookingsForCustomer,
  listBookingsForProvider,
} from './bookings.repository.js';
import type { BookingListQueryInput, CreateBookingInput } from './bookings.schemas.js';

const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
// Postgres error codes that mean "this INSERT lost the race for the slot."
// 23P01 (exclusion_violation) is the EXCLUDE constraint itself rejecting an
// overlapping row (src/db/migrations/0001_bookings_no_overlap_exclusion.sql).
// 40P01 (deadlock_detected) shows up too: when many transactions insert
// overlapping ranges into the same GiST-indexed column at once, Postgres's
// lock manager can detect a cycle among them before the exclusion check even
// runs, and aborts one or more as deadlock victims. A deadlock victim is
// automatically rolled back and did no work, so it's exactly as safe to
// treat as "someone else got there first" as a real exclusion violation -
// this is a documented characteristic of GiST exclusion constraints under
// write contention, not a sign anything is wrong.
const RETRYABLE_CONFLICT_CODES = new Set(['23P01', '40P01']);

export function isSlotConflict(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return (
    cause !== null &&
    cause !== undefined &&
    typeof cause === 'object' &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    RETRYABLE_CONFLICT_CODES.has(cause.code)
  );
}

/**
 * Books a slot for a customer. This has two layers of defense against
 * double-booking, on purpose:
 *
 * 1. Before inserting, it asks slot computation whether the requested time
 *    is actually one of the provider's open slots. This is a friendly,
 *    specific error for the common case - wrong time, outside business
 *    hours, already booked, blocked - and it's the only check for all of
 *    those except "already booked".
 * 2. The INSERT itself can still fail - via the EXCLUDE constraint directly,
 *    or via a deadlock the constraint's locking triggers under contention
 *    (see RETRYABLE_CONFLICT_CODES above) - because step 1 can't see a
 *    booking made by a *concurrent* request that hasn't committed yet. That
 *    race is exactly what the constraint exists for, and is what the
 *    concurrency test in test/integration/bookings-concurrency.test.ts
 *    proves: when many requests race for the same slot, step 1 passes for
 *    all of them, and the database allows exactly one INSERT through.
 */
export async function createBooking(
  db: Database,
  customerId: string,
  input: CreateBookingInput,
  now = new Date(),
): Promise<Booking> {
  const provider = await findProviderById(db, input.providerId);
  if (!provider) {
    throw AppError.notFound('Provider');
  }

  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= now.getTime()) {
    throw AppError.badRequest('startsAt must be in the future');
  }
  const endsAt = new Date(startsAt.getTime() + provider.sessionLengthMinutes * 60_000);

  const openSlots = await getOpenSlotsForProvider(
    db,
    input.providerId,
    startsAt,
    new Date(startsAt.getTime() + 1),
    now,
  );
  const isOpen = openSlots.some((slot) => slot.startsAt.getTime() === startsAt.getTime());
  if (!isOpen) {
    throw AppError.conflict('SLOT_NOT_AVAILABLE', 'This slot is not available for booking');
  }

  try {
    return await insertBooking(db, { providerId: input.providerId, customerId, startsAt, endsAt });
  } catch (err) {
    if (isSlotConflict(err)) {
      throw AppError.conflict('SLOT_NOT_AVAILABLE', 'This slot is not available for booking');
    }
    throw err;
  }
}

async function requireOwnedBooking(db: Database, id: string, customerId: string): Promise<Booking> {
  const booking = await findBookingById(db, id);
  // A booking that exists but belongs to someone else is reported the same
  // way as one that doesn't exist, so the response never confirms whether
  // a given booking id belongs to another customer.
  if (!booking || booking.customerId !== customerId) {
    throw AppError.notFound('Booking');
  }
  return booking;
}

export async function cancelBooking(
  db: Database,
  customerId: string,
  id: string,
  now = new Date(),
): Promise<Booking> {
  const booking = await requireOwnedBooking(db, id, customerId);
  if (booking.status === 'cancelled') {
    throw AppError.conflict('ALREADY_CANCELLED', 'This booking is already cancelled');
  }
  if (booking.startsAt.getTime() - now.getTime() < CANCELLATION_WINDOW_MS) {
    throw AppError.conflict(
      'CANCELLATION_WINDOW_PASSED',
      'Bookings can only be cancelled at least 24 hours before the start time',
    );
  }

  const cancelled = await cancelBookingById(db, id, customerId);
  if (!cancelled) {
    // Lost a race with another cancel request for the same booking.
    throw AppError.conflict('ALREADY_CANCELLED', 'This booking is already cancelled');
  }
  return cancelled;
}

export async function listCustomerBookings(
  db: Database,
  customerId: string,
  query: BookingListQueryInput,
): Promise<{ data: Booking[]; pagination: PaginationMeta }> {
  const pagination: Pagination = { page: query.page, pageSize: query.pageSize };
  const { rows, total } = await listBookingsForCustomer(db, customerId, {
    status: query.status,
    sortOrder: query.sortOrder,
    limit: pagination.pageSize,
    offset: offsetFor(pagination),
  });
  return { data: rows, pagination: paginationMeta(pagination, total) };
}

export async function listProviderBookings(
  db: Database,
  userId: string,
  query: BookingListQueryInput,
): Promise<{ data: Booking[]; pagination: PaginationMeta }> {
  const provider = await findProviderByUserId(db, userId);
  if (!provider) {
    throw AppError.notFound('Provider profile');
  }
  const pagination: Pagination = { page: query.page, pageSize: query.pageSize };
  const { rows, total } = await listBookingsForProvider(db, provider.id, {
    status: query.status,
    sortOrder: query.sortOrder,
    limit: pagination.pageSize,
    offset: offsetFor(pagination),
  });
  return { data: rows, pagination: paginationMeta(pagination, total) };
}
