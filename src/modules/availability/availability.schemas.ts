import { z } from 'zod';
import { PaginationQuery, paginatedResponseSchema } from '../../lib/pagination.js';

export const AvailabilityRuleBody = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((v) => v.startMinute < v.endMinute, {
    message: 'startMinute must be before endMinute',
    path: ['endMinute'],
  });
export type AvailabilityRuleInput = z.infer<typeof AvailabilityRuleBody>;

export const AvailabilityRulePublic = z.object({
  id: z.string().uuid(),
  dayOfWeek: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
  createdAt: z.string(),
});

export const AvailabilityRuleListResponse = z.array(AvailabilityRulePublic);

export const BlockedSlotBody = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => new Date(v.startsAt).getTime() < new Date(v.endsAt).getTime(), {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });
export type BlockedSlotInput = z.infer<typeof BlockedSlotBody>;

export const BlockedSlotPublic = z.object({
  id: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const BlockedSlotListQuery = PaginationQuery;
export const BlockedSlotListResponse = paginatedResponseSchema(BlockedSlotPublic);

export const RuleIdParams = z.object({ ruleId: z.string().uuid() });
export const BlockIdParams = z.object({ blockId: z.string().uuid() });
