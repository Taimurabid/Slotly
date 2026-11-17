import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../db/schema/users.js';
import { AppError } from './errors.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed hash (shouldn't happen, but argon2.verify throws rather
    // than returning false for it) means the password is not valid either.
    return false;
  }
}

/** A URL-safe random refresh token. Only its hash is ever stored. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** OpenAPI security requirement for routes behind `authenticate`, so Swagger UI shows the lock icon and its "Authorize" button works against them. */
export const BEARER_AUTH_SECURITY = [{ bearerAuth: [] }];

/** Fastify preHandler: rejects the request unless it has a valid access token. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

/** Fastify preHandler factory: rejects the request unless the user has `role`. Use after `authenticate`. */
export function requireRole(role: UserRole) {
  return async function (request: FastifyRequest): Promise<void> {
    if (request.user.role !== role) {
      throw AppError.forbidden(`This action requires the ${role} role`);
    }
  };
}
