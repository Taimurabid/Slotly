import { z } from 'zod';

// `page` is capped (SEC-07): with no upper bound, a very large page number
// produces a very large SQL OFFSET that Postgres still has to count past -
// a deep-pagination performance issue, not a correctness one, but cheap to
// just not allow.
export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationQuery>;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginationMeta(pagination: Pagination, total: number): PaginationMeta {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}

export function offsetFor(pagination: Pagination): number {
  return (pagination.page - 1) * pagination.pageSize;
}

const PaginationMetaSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export function paginatedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: PaginationMetaSchema,
  });
}
