import { z } from 'zod';
import { PaginationQuery, paginatedResponseSchema } from '../../lib/pagination.js';

export const CreateBookingBody = z.object({
  providerId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
});
export type CreateBookingInput = z.infer<typeof CreateBookingBody>;

export const BookingPublic = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  customerId: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(['confirmed', 'cancelled']),
  createdAt: z.string(),
});

export const BookingListQuery = PaginationQuery.extend({
  status: z.enum(['confirmed', 'cancelled']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type BookingListQueryInput = z.infer<typeof BookingListQuery>;

export const BookingListResponse = paginatedResponseSchema(BookingPublic);

export const BookingIdParams = z.object({ id: z.string().uuid() });
