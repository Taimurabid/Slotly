import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp(env);

  // Graceful shutdown: stop accepting connections, let in-flight requests finish,
  // then close plugins (later: the DB pool). Render/Docker send SIGTERM on deploy.
  const shutdown = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'Error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
