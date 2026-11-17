import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AvailabilityRule, BlockedSlot } from '../../db/schema/availability.js';
import { requireRole } from '../../lib/auth.js';
import { ErrorBodySchema } from '../../lib/errors.js';
import { ProviderIdParams } from '../providers/providers.schemas.js';
import { getProviderProfile } from '../providers/providers.service.js';
import {
  AvailabilityRuleBody,
  AvailabilityRuleListResponse,
  AvailabilityRulePublic,
  BlockedSlotBody,
  BlockedSlotListQuery,
  BlockedSlotListResponse,
  BlockedSlotPublic,
  BlockIdParams,
  RuleIdParams,
} from './availability.schemas.js';
import {
  addAvailabilityRule,
  addBlockedSlot,
  getAvailabilityRules,
  listBlockedSlots,
  removeAvailabilityRule,
  removeBlockedSlot,
} from './availability.service.js';

function toPublicRule(rule: AvailabilityRule) {
  return {
    id: rule.id,
    dayOfWeek: rule.dayOfWeek,
    startMinute: rule.startMinute,
    endMinute: rule.endMinute,
    createdAt: rule.createdAt.toISOString(),
  };
}

function toPublicBlock(block: BlockedSlot) {
  return {
    id: block.id,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    reason: block.reason,
    createdAt: block.createdAt.toISOString(),
  };
}

export const availabilityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/providers/me/availability-rules',
    {
      schema: {
        tags: ['availability'],
        summary: 'Add a weekly recurring availability rule',
        body: AvailabilityRuleBody,
        response: { 201: AvailabilityRulePublic, 404: ErrorBodySchema },
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request, reply) => {
      const rule = await addAvailabilityRule(app.db, request.user.sub, request.body);
      return reply.status(201).send(toPublicRule(rule));
    },
  );

  app.get(
    '/providers/:id/availability-rules',
    {
      schema: {
        tags: ['availability'],
        summary: "List a provider's weekly availability rules",
        params: ProviderIdParams,
        response: { 200: AvailabilityRuleListResponse, 404: ErrorBodySchema },
      },
    },
    async (request) => {
      await getProviderProfile(app.db, request.params.id);
      const rules = await getAvailabilityRules(app.db, request.params.id);
      return rules.map(toPublicRule);
    },
  );

  app.delete(
    '/providers/me/availability-rules/:ruleId',
    {
      schema: {
        tags: ['availability'],
        summary: 'Remove an availability rule',
        params: RuleIdParams,
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request, reply) => {
      await removeAvailabilityRule(app.db, request.user.sub, request.params.ruleId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/providers/me/blocked-slots',
    {
      schema: {
        tags: ['availability'],
        summary: 'Add a one-off blocked date/time range',
        body: BlockedSlotBody,
        response: { 201: BlockedSlotPublic, 404: ErrorBodySchema },
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request, reply) => {
      const block = await addBlockedSlot(app.db, request.user.sub, request.body);
      return reply.status(201).send(toPublicBlock(block));
    },
  );

  app.get(
    '/providers/:id/blocked-slots',
    {
      schema: {
        tags: ['availability'],
        summary: "List a provider's one-off blocked date/time ranges",
        params: ProviderIdParams,
        querystring: BlockedSlotListQuery,
        response: { 200: BlockedSlotListResponse, 404: ErrorBodySchema },
      },
    },
    async (request) => {
      await getProviderProfile(app.db, request.params.id);
      const result = await listBlockedSlots(app.db, request.params.id, request.query);
      return { data: result.data.map(toPublicBlock), pagination: result.pagination };
    },
  );

  app.delete(
    '/providers/me/blocked-slots/:blockId',
    {
      schema: {
        tags: ['availability'],
        summary: 'Remove a one-off blocked date/time range',
        params: BlockIdParams,
      },
      preHandler: [app.authenticate, requireRole('provider')],
    },
    async (request, reply) => {
      await removeBlockedSlot(app.db, request.user.sub, request.params.blockId);
      return reply.status(204).send();
    },
  );
};
