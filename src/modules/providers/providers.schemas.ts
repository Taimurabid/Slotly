import { z } from 'zod';
import { PaginationQuery, paginatedResponseSchema } from '../../lib/pagination.js';
import { isValidTimeZone } from '../../lib/time.js';

// The max() runs before the Intl.DateTimeFormat check in isValidTimeZone
// (SEC-09): real IANA zone names are well under 100 characters, so this
// costs nothing for legitimate input and avoids handing an unbounded
// string to Intl internals.
const timezoneField = z
  .string()
  .max(100)
  .refine(isValidTimeZone, { message: 'Must be a valid IANA timezone, e.g. "America/New_York"' });

export const CreateProviderBody = z.object({
  name: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(2000).optional(),
  timezone: timezoneField,
  sessionLengthMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  priceCents: z.number().int().nonnegative(),
});
export type CreateProviderInput = z.infer<typeof CreateProviderBody>;

export const UpdateProviderBody = CreateProviderBody.partial();
export type UpdateProviderInput = z.infer<typeof UpdateProviderBody>;

export const ProviderIdParams = z.object({
  id: z.string().uuid(),
});

export const ProviderPublic = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bio: z.string().nullable(),
  timezone: z.string(),
  sessionLengthMinutes: z.number(),
  priceCents: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const sortFields = ['name', 'priceCents', 'createdAt'] as const;

export const ProviderListQuery = PaginationQuery.extend({
  search: z.string().trim().min(1).max(200).optional(),
  minPriceCents: z.coerce.number().int().nonnegative().optional(),
  maxPriceCents: z.coerce.number().int().nonnegative().optional(),
  sortBy: z.enum(sortFields).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ListProvidersQuery = z.infer<typeof ProviderListQuery>;

export const ProviderListResponse = paginatedResponseSchema(ProviderPublic);
