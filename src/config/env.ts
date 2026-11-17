import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at boot.
 * If anything is missing or malformed the process exits with a clear message,
 * instead of failing later with a confusing runtime error.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Rejecting a literal "*" is deliberate (SEC-02): @fastify/cors treats a
  // wildcard inside an array of allowed origins as "allow everything," and
  // this app registers CORS with `credentials: true` - allow-all plus
  // credentials is exactly the misconfiguration that matters most to catch
  // at boot, the same way JWT_ACCESS_SECRET's length is.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => !origins.includes('*'), {
      message:
        'CORS_ORIGINS must not include "*" - list exact allowed origins instead. ' +
        "A wildcard combined with this app's credentials:true CORS setting would " +
        'allow any website to make credentialed requests.',
    }),

  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
