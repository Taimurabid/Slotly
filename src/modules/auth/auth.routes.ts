import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorBodySchema } from '../../lib/errors.js';
import {
  AuthResponse,
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
  TokenResponse,
} from './auth.schemas.js';
import {
  issueRefreshToken,
  registerUser,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyCredentials,
  type RegisterInput,
} from './auth.service.js';
import type { User } from '../../db/schema/users.js';

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

const authRateLimit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const ttlDays = app.config.REFRESH_TOKEN_TTL_DAYS;
  const rateLimitConfig = authRateLimit(app.config.RATE_LIMIT_AUTH_MAX);

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: RegisterBody,
        response: { 201: AuthResponse, 400: ErrorBodySchema, 409: ErrorBodySchema },
      },
      config: rateLimitConfig,
    },
    async (request, reply) => {
      const input: RegisterInput = request.body;
      const user = await registerUser(app.db, input);
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role });
      const refreshToken = await issueRefreshToken(app.db, user.id, ttlDays);
      return reply.status(201).send({ user: toPublicUser(user), accessToken, refreshToken });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in with email and password',
        body: LoginBody,
        response: { 200: AuthResponse, 401: ErrorBodySchema },
      },
      config: rateLimitConfig,
    },
    async (request) => {
      const user = await verifyCredentials(app.db, request.body.email, request.body.password);
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role });
      const refreshToken = await issueRefreshToken(app.db, user.id, ttlDays);
      return { user: toPublicUser(user), accessToken, refreshToken };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a new access and refresh token',
        body: RefreshBody,
        response: { 200: TokenResponse, 401: ErrorBodySchema },
      },
      config: rateLimitConfig,
    },
    async (request) => {
      const rotated = await rotateRefreshToken(app.db, request.body.refreshToken, ttlDays);
      const accessToken = app.jwt.sign({ sub: rotated.userId, role: rotated.role });
      return { accessToken, refreshToken: rotated.refreshToken };
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token',
        body: LogoutBody,
      },
      config: rateLimitConfig,
    },
    async (request, reply) => {
      await revokeRefreshToken(app.db, request.body.refreshToken);
      return reply.status(204).send();
    },
  );
};
