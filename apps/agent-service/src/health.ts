import { createServer, type Server } from 'node:http';
import type { Queue } from 'bullmq';
import { logger } from './logger.js';

export interface HealthDeps {
  port: number;
  queues: Record<string, Queue>;
  ready: () => boolean;
}

/** Minimal `/health` (liveness) + `/ready` (readiness + queue depths) endpoint. */
export function startHealthServer(deps: HealthDeps): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }
    if (req.url === '/ready') {
      void (async () => {
        const counts: Record<string, unknown> = {};
        for (const [name, q] of Object.entries(deps.queues)) {
          counts[name] = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        }
        const ready = deps.ready();
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready, queues: counts }));
      })().catch((err: unknown) => {
        logger.error({ err }, 'ready check failed');
        res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(deps.port, () => logger.info({ port: deps.port }, 'health server listening'));
  return server;
}
