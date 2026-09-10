import type { Queue } from 'bullmq';
import { closeDb } from '@float/db';
import { startHealthServer } from './health.js';
import { logger } from './logger.js';
import { QUEUE, connectionFor, makeQueue, type EvaluateJob, type ExecuteJob } from './queues.js';

type TickJob = Record<string, never>;
import { getRuntime } from './runtime.js';
import { startBalanceWatcher } from './watchers/balance-watcher.js';
import { startEvaluateWorker } from './workers/evaluate.js';
import { startExecuteWorker } from './workers/execute.js';
import { startOracleSyncWorker } from './workers/oracle-sync.js';
import { startPolicySyncWorker } from './workers/policy-sync.js';

const ORACLE_TICK_MS = 30_000;
const POLICY_TICK_MS = 60_000;

function main(): void {
  const rt = getRuntime();
  const conn = connectionFor(rt.redis);

  const evaluateQueue = makeQueue<EvaluateJob>(QUEUE.evaluate, conn);
  const executeQueue = makeQueue<ExecuteJob>(QUEUE.execute, conn);
  const oracleSyncQueue = makeQueue<TickJob>(QUEUE.oracleSync, conn);
  const policySyncQueue = makeQueue<TickJob>(QUEUE.policySync, conn);
  const allQueues: Record<string, Queue> = {
    evaluate: evaluateQueue,
    execute: executeQueue,
    oracleSync: oracleSyncQueue,
    policySync: policySyncQueue,
  };

  const workers = [
    startEvaluateWorker(rt, executeQueue),
    startExecuteWorker(rt),
    startOracleSyncWorker(rt),
    startPolicySyncWorker(rt),
  ];
  const stopWatcher = startBalanceWatcher(rt, evaluateQueue);

  const tick = (q: Queue<TickJob>, period: number, name: string) =>
    setInterval(() => {
      void q
        .add(name, {}, { jobId: `${name}:${Math.floor(Date.now() / period)}` })
        .catch((err: unknown) => logger.error({ err }, 'tick enqueue failed'));
    }, period);
  const oracleTick = tick(oracleSyncQueue, ORACLE_TICK_MS, 'oracle-sync');
  const policyTick = tick(policySyncQueue, POLICY_TICK_MS, 'policy-sync');

  let ready = true;
  const health = startHealthServer({
    port: rt.env.AGENT_SERVICE_PORT,
    queues: allQueues,
    ready: () => ready,
  });

  logger.info(
    {
      chain: rt.chainKey,
      executor: rt.deployment.sweepExecutor,
      agent: rt.signers.agentSession.address,
    },
    'agent-service started',
  );

  let shuttingDown = false;
  async function shutdown(sig: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    logger.info({ sig }, 'shutting down');
    clearInterval(oracleTick);
    clearInterval(policyTick);
    stopWatcher();
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled(Object.values(allQueues).map((q) => q.close()));
    health.close();
    await closeDb();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

try {
  main();
} catch (err: unknown) {
  logger.fatal({ err }, 'agent-service failed to start');
  process.exit(1);
}
