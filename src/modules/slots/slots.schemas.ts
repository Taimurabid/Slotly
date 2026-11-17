import { z } from 'zod';

const MAX_RANGE_DAYS = 90;

export const SlotsQuery = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.from).getTime() < new Date(v.to).getTime(), {
    message: 'from must be before to',
    path: ['to'],
  })
  .refine(
    (v) =>
      new Date(v.to).getTime() - new Date(v.from).getTime() <= MAX_RANGE_DAYS * 24 * 60 * 60 * 1000,
    { message: `from/to range cannot exceed ${MAX_RANGE_DAYS} days`, path: ['to'] },
  );
export type SlotsQueryInput = z.infer<typeof SlotsQuery>;

export const SlotPublic = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
});

export const SlotsListResponse = z.array(SlotPublic);
