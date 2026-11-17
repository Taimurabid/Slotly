import { and, asc, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  providerProfiles,
  type NewProviderProfile,
  type ProviderProfile,
} from '../../db/schema/providers.js';

export function findProviderByUserId(
  db: Database,
  userId: string,
): Promise<ProviderProfile | undefined> {
  return db.query.providerProfiles.findFirst({ where: eq(providerProfiles.userId, userId) });
}

export function findProviderById(db: Database, id: string): Promise<ProviderProfile | undefined> {
  return db.query.providerProfiles.findFirst({ where: eq(providerProfiles.id, id) });
}

export async function insertProvider(
  db: Database,
  values: NewProviderProfile,
): Promise<ProviderProfile> {
  const [row] = await db.insert(providerProfiles).values(values).returning();
  if (!row) throw new Error('Insert into provider_profiles returned no row');
  return row;
}

export async function updateProviderById(
  db: Database,
  id: string,
  values: Partial<NewProviderProfile>,
): Promise<ProviderProfile> {
  const [row] = await db
    .update(providerProfiles)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(providerProfiles.id, id))
    .returning();
  if (!row) throw new Error('Update of provider_profiles returned no row');
  return row;
}

export interface ListProvidersFilter {
  search?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  sortBy: 'name' | 'priceCents' | 'createdAt';
  sortOrder: 'asc' | 'desc';
  limit: number;
  offset: number;
}

const sortColumn = {
  name: providerProfiles.name,
  priceCents: providerProfiles.priceCents,
  createdAt: providerProfiles.createdAt,
} as const;

export async function listProviders(
  db: Database,
  filter: ListProvidersFilter,
): Promise<{ rows: ProviderProfile[]; total: number }> {
  const conditions: SQL[] = [];
  if (filter.search) conditions.push(ilike(providerProfiles.name, `%${filter.search}%`));
  if (filter.minPriceCents !== undefined) {
    conditions.push(gte(providerProfiles.priceCents, filter.minPriceCents));
  }
  if (filter.maxPriceCents !== undefined) {
    conditions.push(lte(providerProfiles.priceCents, filter.maxPriceCents));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const orderFn = filter.sortOrder === 'asc' ? asc : desc;
  const column = sortColumn[filter.sortBy];

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(providerProfiles)
      .where(where)
      .orderBy(orderFn(column))
      .limit(filter.limit)
      .offset(filter.offset),
    db.select({ value: count() }).from(providerProfiles).where(where),
  ]);

  return { rows, total: totalRows[0]?.value ?? 0 };
}
