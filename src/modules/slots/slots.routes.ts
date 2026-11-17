import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorBodySchema } from '../../lib/errors.js';
import { ProviderIdParams } from '../providers/providers.schemas.js';
import { SlotsListResponse, SlotsQuery } from './slots.schemas.js';
import { getOpenSlotsForProvider } from './slots.service.js';

export const slotsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/providers/:id/slots',
    {
      schema: {
        tags: ['slots'],
        summary: 'List open bookable slots for a provider in a date range',
        params: ProviderIdParams,
        querystring: SlotsQuery,
        response: { 200: SlotsListResponse, 400: ErrorBodySchema, 404: ErrorBodySchema },
      },
    },
    async (request) => {
      const { from, to } = request.query;
      const slots = await getOpenSlotsForProvider(
        app.db,
        request.params.id,
        new Date(from),
        new Date(to),
      );
      return slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      }));
    },
  );
};
