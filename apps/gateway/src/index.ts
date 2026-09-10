import { serve } from '@hono/node-server';
import { closeDb } from '@float/db';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { getRuntime } from './runtime.js';

try {
  const rt = getRuntime();
  const app = createApp(rt);
  const server = serve({ fetch: app.fetch, port: rt.port }, (info) => {
    logger.info(
      { port: info.port, chain: rt.chainKey, x402: rt.x402.enabled ? rt.x402.mode : 'disabled' },
      'gateway listening',
    );
  });

  const shutdown = (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close(() => {
      void closeDb().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (err) {
  logger.fatal({ err }, 'gateway failed to start');
  process.exit(1);
}
