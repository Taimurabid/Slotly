import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';

/**
 * Applies pending SQL migrations from src/db/migrations. Run explicitly
 * (`npm run db:migrate`) rather than on every server boot, so a deploy's
 * migration step is a distinct, observable action and multiple API
 * instances starting at once can never race to migrate concurrently.
 */
async function main() {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
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
