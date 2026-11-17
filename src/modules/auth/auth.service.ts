import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import type { Database } from '../../db/client.js';
import type { User, UserRole } from '../../db/schema/users.js';
import {
  findRefreshTokenByHash,
  findUserByEmail,
  incrementFailedLoginAttempts,
  insertRefreshToken,
  insertUser,
  lockAccountUntil,
  resetFailedLoginAttempts,
  revokeAllRefreshTokensForUser,
  revokeRefreshTokenByHash,
  revokeRefreshTokenById,
} from './auth.repository.js';

export interface RegisterInput {
  email: string;
  password: string;
  role: UserRole;
}

export async function registerUser(db: Database, input: RegisterInput): Promise<User> {
  const existing = await findUserByEmail(db, input.email);
  if (existing) {
    throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  const passwordHash = await hashPassword(input.password);
  return insertUser(db, { email: input.email, passwordHash, role: input.role });
}

// SEC-04: per-account lockout, independent of the existing per-IP rate
// limit on /auth/login. 5 consecutive failures locks the account for 15
// minutes; a successful login resets the counter.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * The response is identical - "Invalid email or password" - whether the
 * account doesn't exist, the password is wrong, or the account is
 * currently locked. Returning a distinct "this account is locked" message
 * would let an attacker distinguish "exists and is locked" from "doesn't
 * exist," reintroducing the account-enumeration problem this error message
 * already avoids for the unknown-email and wrong-password cases.
 */
export async function verifyCredentials(
  db: Database,
  email: string,
  password: string,
  now = new Date(),
): Promise<User> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    throw AppError.unauthorized('Invalid email or password');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    throw AppError.unauthorized('Invalid email or password');
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const attempts = await incrementFailedLoginAttempts(db, user.id);
    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await lockAccountUntil(db, user.id, new Date(now.getTime() + LOCKOUT_DURATION_MS));
    }
    throw AppError.unauthorized('Invalid email or password');
  }

  await resetFailedLoginAttempts(db, user.id);
  return user;
}

function refreshTokenExpiry(ttlDays: number): Date {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(
  db: Database,
  userId: string,
  ttlDays: number,
): Promise<string> {
  const token = generateRefreshToken();
  await insertRefreshToken(db, {
    userId,
    tokenHash: hashRefreshToken(token),
    expiresAt: refreshTokenExpiry(ttlDays),
  });
  return token;
}

export interface RotatedRefreshToken {
  userId: string;
  role: UserRole;
  refreshToken: string;
}

/**
 * Verifies and rotates a refresh token: the old one is revoked and a new one
 * issued in its place. Rotation (rather than reusing the same token
 * indefinitely) limits how long a stolen token stays useful, and a reuse of
 * an already-revoked token is a signal the token was stolen.
 */
export async function rotateRefreshToken(
  db: Database,
  token: string,
  ttlDays: number,
): Promise<RotatedRefreshToken> {
  const row = await findRefreshTokenByHash(db, hashRefreshToken(token));
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
  await revokeRefreshTokenById(db, row.id);
  const refreshToken = await issueRefreshToken(db, row.userId, ttlDays);
  return { userId: row.userId, role: row.userRole, refreshToken };
}

/** Revoking an unknown or already-revoked token is not an error: logout is idempotent. */
export async function revokeRefreshToken(db: Database, token: string): Promise<void> {
  await revokeRefreshTokenByHash(db, hashRefreshToken(token));
}

/**
 * SEC-06: revokes every refresh token belonging to a user, not just the one
 * presented. For "log out everywhere" / "I think my account is
 * compromised" - unlike /auth/logout, this is authenticated by access
 * token (the caller doesn't need to have a specific refresh token on hand).
 */
export async function logoutAllSessions(db: Database, userId: string): Promise<void> {
  await revokeAllRefreshTokensForUser(db, userId);
}
