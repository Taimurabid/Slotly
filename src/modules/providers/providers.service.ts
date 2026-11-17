import type { Database } from '../../db/client.js';
import type { ProviderProfile } from '../../db/schema/providers.js';
import { AppError } from '../../lib/errors.js';
import {
  offsetFor,
  paginationMeta,
  type Pagination,
  type PaginationMeta,
} from '../../lib/pagination.js';
import {
  findProviderById,
  findProviderByUserId,
  insertProvider,
  listProviders as listProvidersRepo,
  updateProviderById,
} from './providers.repository.js';
import type {
  CreateProviderInput,
  ListProvidersQuery,
  UpdateProviderInput,
} from './providers.schemas.js';

export async function createProviderProfile(
  db: Database,
  userId: string,
  input: CreateProviderInput,
): Promise<ProviderProfile> {
  const existing = await findProviderByUserId(db, userId);
  if (existing) {
    throw AppError.conflict('PROVIDER_PROFILE_EXISTS', 'You already have a provider profile');
  }
  return insertProvider(db, { userId, ...input });
}

export async function updateProviderProfile(
  db: Database,
  userId: string,
  input: UpdateProviderInput,
): Promise<ProviderProfile> {
  const existing = await findProviderByUserId(db, userId);
  if (!existing) {
    throw AppError.notFound('Provider profile');
  }
  return updateProviderById(db, existing.id, input);
}

export async function getOwnProviderProfile(
  db: Database,
  userId: string,
): Promise<ProviderProfile> {
  const provider = await findProviderByUserId(db, userId);
  if (!provider) {
    throw AppError.notFound('Provider profile');
  }
  return provider;
}

export async function getProviderProfile(db: Database, id: string): Promise<ProviderProfile> {
  const provider = await findProviderById(db, id);
  if (!provider) {
    throw AppError.notFound('Provider');
  }
  return provider;
}

export async function listProviderProfiles(
  db: Database,
  query: ListProvidersQuery,
): Promise<{ data: ProviderProfile[]; pagination: PaginationMeta }> {
  const pagination: Pagination = { page: query.page, pageSize: query.pageSize };
  const { rows, total } = await listProvidersRepo(db, {
    search: query.search,
    minPriceCents: query.minPriceCents,
    maxPriceCents: query.maxPriceCents,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: pagination.pageSize,
    offset: offsetFor(pagination),
  });
  return { data: rows, pagination: paginationMeta(pagination, total) };
}
