import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import { authenticate } from './lib/auth.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { availabilityRoutes } from './modules/availability/availability.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { providerRoutes } from './modules/providers/providers.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    db: Database;
    authenticate: typeof authenticate;
  }
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test') return false;
  return {
    level: env.LOG_LEVEL,
    // Never write credentials to logs.
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    // Human-readable logs locally, JSON lines in production (what log platforms expect).
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

/**
 * Builds the Fastify app without starting it. Tests call this directly,
 * so they exercise the exact same wiring as production.
 */
export async function buildApp(env: Env) {
  const app = Fastify({
    logger: loggerOptions(env),
    // Reuse an incoming X-Request-Id (from a load balancer) or generate one,
    // so every log line for a request can be correlated.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: env.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  // Zod schemas validate input and serialize output for every route.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', env);

  const { db, pool } = createDb(env.DATABASE_URL);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });
  app.decorate('authenticate', authenticate);

  // Rate limiting is off by default (`global: false`) and opted into per
  // route via `config.rateLimit`, so only auth routes pay for it.
  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(providerRoutes);
  await app.register(availabilityRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
