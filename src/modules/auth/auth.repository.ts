import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { refreshTokens } from '../../db/schema/refresh-tokens.js';
import { users, type NewUser, type User } from '../../db/schema/users.js';

export function findUserByEmail(db: Database, email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

export async function insertUser(db: Database, user: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(user).returning();
  if (!row) throw new Error('Insert into users returned no row');
  return row;
}

export interface RefreshTokenWithRole {
  id: string;
  userId: string;
  userRole: User['role'];
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function insertRefreshToken(
  db: Database,
  values: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.insert(refreshTokens).values(values);
}

export async function findRefreshTokenByHash(
  db: Database,
  tokenHash: string,
): Promise<RefreshTokenWithRole | undefined> {
  const row = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
    with: { user: { columns: { role: true } } },
  });
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.userId,
    userRole: row.user.role,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export async function revokeRefreshTokenById(db: Database, id: string): Promise<void> {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id));
}

export async function revokeRefreshTokenByHash(db: Database, tokenHash: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

/** SEC-06: revokes every refresh token for a user ("log out everywhere"). */
export async function revokeAllRefreshTokensForUser(db: Database, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
