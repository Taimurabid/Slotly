import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/**
 * Applies pending SQL migrations from src/db/migrations. Run explicitly
 * (`npm run db:migrate`) rather than on every server boot, so a deploy's
 * migration step is a distinct, observable action and multiple API
 * instances starting at once can never race to migrate concurrently.
 *
 * Reads DATABASE_URL directly instead of the app's full env schema
 * (src/config/env.ts), because a migration run has nothing to do with
 * JWT secrets, CORS origins, or any other app-level config.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
