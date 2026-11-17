import { and, asc, count, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  availabilityRules,
  blockedSlots,
  type AvailabilityRule,
  type BlockedSlot,
  type NewAvailabilityRule,
  type NewBlockedSlot,
} from '../../db/schema/availability.js';

export async function insertAvailabilityRule(
  db: Database,
  values: NewAvailabilityRule,
): Promise<AvailabilityRule> {
  const [row] = await db.insert(availabilityRules).values(values).returning();
  if (!row) throw new Error('Insert into availability_rules returned no row');
  return row;
}

export function listAvailabilityRules(
  db: Database,
  providerId: string,
): Promise<AvailabilityRule[]> {
  return db.query.availabilityRules.findMany({
    where: eq(availabilityRules.providerId, providerId),
    orderBy: [asc(availabilityRules.dayOfWeek), asc(availabilityRules.startMinute)],
  });
}

export async function deleteAvailabilityRule(
  db: Database,
  providerId: string,
  ruleId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(availabilityRules)
    .where(and(eq(availabilityRules.id, ruleId), eq(availabilityRules.providerId, providerId)))
    .returning({ id: availabilityRules.id });
  return deleted.length > 0;
}

export async function insertBlockedSlot(
  db: Database,
  values: NewBlockedSlot,
): Promise<BlockedSlot> {
  const [row] = await db.insert(blockedSlots).values(values).returning();
  if (!row) throw new Error('Insert into blocked_slots returned no row');
  return row;
}

export async function listBlockedSlots(
  db: Database,
  providerId: string,
  limit: number,
  offset: number,
): Promise<{ rows: BlockedSlot[]; total: number }> {
  const [rows, totalRows] = await Promise.all([
    db.query.blockedSlots.findMany({
      where: eq(blockedSlots.providerId, providerId),
      orderBy: [asc(blockedSlots.startsAt)],
      limit,
      offset,
    }),
    db.select({ value: count() }).from(blockedSlots).where(eq(blockedSlots.providerId, providerId)),
  ]);
  return { rows, total: totalRows[0]?.value ?? 0 };
}

export async function deleteBlockedSlot(
  db: Database,
  providerId: string,
  blockId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(blockedSlots)
    .where(and(eq(blockedSlots.id, blockId), eq(blockedSlots.providerId, providerId)))
    .returning({ id: blockedSlots.id });
  return deleted.length > 0;
}
