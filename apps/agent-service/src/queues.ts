import { Queue, Worker, type ConnectionOptions, type Processor, type WorkerOptions } from 'bullmq';
import type { RedisConnection } from './runtime.js';

export const QUEUE = {
  evaluate: 'float:evaluate',
  execute: 'float:execute',
  oracleSync: 'float:oracle-sync',
  policySync: 'float:policy-sync',
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
  return new Worker<T>(name, processor, { connection, concurrency: 1, ...opts });
}

/** `<businessId>:<direction>:<hour-bucket>` — one sweep per business per direction per hour. */
export function sweepIdempotencyKey(
  businessId: string,
  direction: 'in' | 'out',
  windowStartMs: number,
): string {
  const bucket = Math.floor(windowStartMs / 3600_000);
  return `${businessId}:${direction}:${bucket}`;
}
