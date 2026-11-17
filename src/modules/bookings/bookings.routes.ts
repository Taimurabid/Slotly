import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Booking } from '../../db/schema/bookings.js';
import { requireRole } from '../../lib/auth.js';
import { ErrorBodySchema } from '../../lib/errors.js';
import {
  BookingIdParams,
  BookingListQuery,
  BookingListResponse,
  BookingPublic,
  CreateBookingBody,
} from './bookings.schemas.js';
import {
  cancelBooking,
  createBooking,
  listCustomerBookings,
  listProviderBookings,
} from './bookings.service.js';

function toPublicBooking(booking: Booking) {
  return {
    id: booking.id,
    providerId: booking.providerId,
    customerId: booking.customerId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
  };
}

export const bookingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/bookings',
    {
      schema: {
        tags: ['bookings'],
        summary: 'Book an open slot',
        body: CreateBookingBody,
        response: {
          201: BookingPublic,
          400: ErrorBodySchema,
          404: ErrorBodySchema,
          409: ErrorBodySchema,
        },
      },
      preHandler: [app.authenticate, requireRole('customer')],
    },
    async (request, reply) => {
      const booking = await createBooking(app.db, request.user.sub, request.body);
      return reply.status(201).send(toPublicBooking(booking));
    },
  );

  app.get(
    '/bookings/me',
    {
      schema: {
        tags: ['bookings'],
        summary: "List the caller's own bookings",
        querystring: BookingListQuery,
        response: { 200: BookingListResponse },
      },
      preHandler: [app.authenticate, requireRole('customer')],
    },
    async (request) => {
      const result = await listCustomerBookings(app.db, request.user.sub, request.query);
      return { data: result.data.map(toPublicBooking), pagination: result.pagination };
    },
  );

  app.get(
    '/providers/me/bookings',
    {
      schema: {
        tags: ['bookings'],
        summary: "List bookings for the caller's own provider profile",
        querystring: BookingListQuery,
        response: { 200: BookingListResponse, 404: ErrorBodySchema },
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request) => {
      const result = await listProviderBookings(app.db, request.user.sub, request.query);
      return { data: result.data.map(toPublicBooking), pagination: result.pagination };
    },
  );

  app.post(
    '/bookings/:id/cancel',
    {
      schema: {
        tags: ['bookings'],
        summary: 'Cancel a booking (must be more than 24 hours before its start time)',
        params: BookingIdParams,
        response: { 200: BookingPublic, 404: ErrorBodySchema, 409: ErrorBodySchema },
      },
      preHandler: [app.authenticate, requireRole('customer')],
    },
    async (request) => {
      const booking = await cancelBooking(app.db, request.user.sub, request.params.id);
      return toPublicBooking(booking);
    },
  );
};
