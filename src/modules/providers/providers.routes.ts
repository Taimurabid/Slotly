import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ProviderProfile } from '../../db/schema/providers.js';
import { BEARER_AUTH_SECURITY, requireRole } from '../../lib/auth.js';
import { ErrorBodySchema } from '../../lib/errors.js';
import {
  CreateProviderBody,
  ProviderIdParams,
  ProviderListQuery,
  ProviderListResponse,
  ProviderPublic,
  UpdateProviderBody,
} from './providers.schemas.js';
import {
  createProviderProfile,
  getOwnProviderProfile,
  getProviderProfile,
  listProviderProfiles,
  updateProviderProfile,
} from './providers.service.js';

function toPublicProvider(provider: ProviderProfile) {
  return {
    id: provider.id,
    name: provider.name,
    bio: provider.bio,
    timezone: provider.timezone,
    sessionLengthMinutes: provider.sessionLengthMinutes,
    priceCents: provider.priceCents,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/providers',
    {
      schema: {
        tags: ['providers'],
        summary: 'Create your provider profile',
        body: CreateProviderBody,
        response: { 201: ProviderPublic, 409: ErrorBodySchema },
        security: BEARER_AUTH_SECURITY,
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request, reply) => {
      const provider = await createProviderProfile(app.db, request.user.sub, request.body);
      return reply.status(201).send(toPublicProvider(provider));
    },
  );

  app.patch(
    '/providers/me',
    {
      schema: {
        tags: ['providers'],
        summary: 'Update your provider profile',
        body: UpdateProviderBody,
        response: { 200: ProviderPublic, 404: ErrorBodySchema },
        security: BEARER_AUTH_SECURITY,
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request) => {
      const provider = await updateProviderProfile(app.db, request.user.sub, request.body);
      return toPublicProvider(provider);
    },
  );

  app.get(
    '/providers/me',
    {
      schema: {
        tags: ['providers'],
        summary: 'Get your own provider profile',
        response: { 200: ProviderPublic, 404: ErrorBodySchema },
        security: BEARER_AUTH_SECURITY,
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request) => {
      const provider = await getOwnProviderProfile(app.db, request.user.sub);
      return toPublicProvider(provider);
    },
  );

  app.get(
    '/providers',
    {
      schema: {
        tags: ['providers'],
        summary: 'List providers',
        querystring: ProviderListQuery,
        response: { 200: ProviderListResponse },
      },
    },
    async (request) => {
      const result = await listProviderProfiles(app.db, request.query);
      return { data: result.data.map(toPublicProvider), pagination: result.pagination };
    },
  );

  app.get(
    '/providers/:id',
    {
      schema: {
        tags: ['providers'],
        summary: 'Get a provider by id',
        params: ProviderIdParams,
        response: { 200: ProviderPublic, 404: ErrorBodySchema },
      },
    },
    async (request) => {
      const provider = await getProviderProfile(app.db, request.params.id);
      return toPublicProvider(provider);
    },
  );
};
