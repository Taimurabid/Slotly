import type { Database } from '../../db/client.js';
import type { AvailabilityRule, BlockedSlot } from '../../db/schema/availability.js';
import { AppError } from '../../lib/errors.js';
import {
  offsetFor,
  paginationMeta,
  type Pagination,
  type PaginationMeta,
} from '../../lib/pagination.js';
import { findProviderByUserId } from '../providers/providers.repository.js';
import {
  deleteAvailabilityRule as deleteAvailabilityRuleRepo,
  deleteBlockedSlot as deleteBlockedSlotRepo,
  insertAvailabilityRule,
  insertBlockedSlot,
  listAvailabilityRules,
  listBlockedSlots as listBlockedSlotsRepo,
} from './availability.repository.js';
import type { AvailabilityRuleInput, BlockedSlotInput } from './availability.schemas.js';

async function requireOwnProviderId(db: Database, userId: string): Promise<string> {
  const provider = await findProviderByUserId(db, userId);
  if (!provider) {
    throw AppError.notFound('Provider profile');
  }
  return provider.id;
}

export async function addAvailabilityRule(
  db: Database,
  userId: string,
  input: AvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const providerId = await requireOwnProviderId(db, userId);
  return insertAvailabilityRule(db, { providerId, ...input });
}

export function getAvailabilityRules(
  db: Database,
  providerId: string,
): Promise<AvailabilityRule[]> {
  return listAvailabilityRules(db, providerId);
}

export async function removeAvailabilityRule(
  db: Database,
  userId: string,
  ruleId: string,
): Promise<void> {
  const providerId = await requireOwnProviderId(db, userId);
  const deleted = await deleteAvailabilityRuleRepo(db, providerId, ruleId);
  if (!deleted) throw AppError.notFound('Availability rule');
}

export async function addBlockedSlot(
  db: Database,
  userId: string,
  input: BlockedSlotInput,
): Promise<BlockedSlot> {
  const providerId = await requireOwnProviderId(db, userId);
  return insertBlockedSlot(db, {
    providerId,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    reason: input.reason,
  });
}

export async function listBlockedSlots(
  db: Database,
  providerId: string,
  pagination: Pagination,
): Promise<{ data: BlockedSlot[]; pagination: PaginationMeta }> {
  const { rows, total } = await listBlockedSlotsRepo(
    db,
    providerId,
    pagination.pageSize,
    offsetFor(pagination),
  );
  return { data: rows, pagination: paginationMeta(pagination, total) };
}

export async function removeBlockedSlot(
  db: Database,
  userId: string,
  blockId: string,
): Promise<void> {
  const providerId = await requireOwnProviderId(db, userId);
  const deleted = await deleteBlockedSlotRepo(db, providerId, blockId);
  if (!deleted) throw AppError.notFound('Blocked slot');
}
