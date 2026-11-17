import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const HealthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
  db: z.literal('ok'),
});

const UnhealthyResponse = z.object({
  status: z.literal('error'),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
  db: z.literal('error'),
});

/**
 * Liveness check used by Docker, Render and uptime monitors. It pings the
 * database too: a server that's up but can't reach Postgres isn't actually
 * healthy, and we want the orchestrator to know that, not just see 200s.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        response: { 200: HealthResponse, 503: UnhealthyResponse },
      },
    },
    async (request, reply) => {
      const base = {
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
      try {
        await app.db.execute(sql`select 1`);
        return { ...base, status: 'ok' as const, db: 'ok' as const };
      } catch (err) {
        request.log.error({ err }, 'Health check failed: database unreachable');
        return reply.status(503).send({ ...base, status: 'error' as const, db: 'error' as const });
      }
    },
  );
};
