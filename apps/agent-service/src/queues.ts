import { Queue, Worker, type ConnectionOptions, type Processor, type WorkerOptions } from 'bullmq';
import { logger } from './logger.js';
import type { RedisConnection } from './runtime.js';

// BullMQ reserves ':' as its own Redis-key separator and rejects it in a
// queue name (throws "Queue name cannot contain :" at construction).
export const QUEUE = {
  evaluate: 'float-evaluate',
  execute: 'float-execute',
  oracleSync: 'float-oracle-sync',
  policySync: 'float-policy-sync',
  provision: 'float-provision',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface EvaluateJob {
  businessId: string;
  reason: string;
}

export interface ExecuteJob {
  businessId: string;
  direction: 'in' | 'out';
  /** USDC base units, decimal string. */
  amountUsdc: string;
  decisionReason: string;
  decisionDetail?: Record<string, string | number | boolean>;
  /** Start of the decision window, ms — part of the idempotency key. */
  windowStartMs: number;
}

/** ioredis connection options bullmq needs (`maxRetriesPerRequest: null` for workers). */
export function connectionFor(redis: RedisConnection): ConnectionOptions {
  return {
    host: redis.host,
    port: redis.port,
    username: redis.username,
    password: redis.password,
    db: redis.db,
    maxRetriesPerRequest: null,
  };
}

export function makeQueue<T>(name: QueueName, connection: ConnectionOptions): Queue<T> {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    },
  });
}

export function makeWorker<T>(
  name: QueueName,
  connection: ConnectionOptions,
  processor: Processor<T>,
  opts: Partial<WorkerOptions> = {},
): Worker<T> {
  const worker = new Worker<T>(name, processor, { connection, concurrency: 1, ...opts });
  // A thrown processor error otherwise only ever surfaces as a 'failed' job in
  // Redis — nothing else in this service logs it. Without this, a worker can
  // fail every tick, forever, with zero visible trace (see docs/runbook.md §7).
  worker.on('failed', (job, err) => {
    logger.error({ queue: name, jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'job failed');
  });
  worker.on('error', (err) => {
    logger.error({ queue: name, err }, 'worker error');
  });
  return worker;
}

/**
 * `<businessId>-<direction>-<hour-bucket>` — one sweep per business per
 * direction per hour. Used as both the `sweeps.idempotency_key` column and a
 * BullMQ job id — BullMQ rejects `:` in custom job ids, same as queue names.
 */
export function sweepIdempotencyKey(
  businessId: string,
  direction: 'in' | 'out',
  windowStartMs: number,
): string {
  const bucket = Math.floor(windowStartMs / 3600_000);
  return `${businessId}-${direction}-${bucket}`;
}
