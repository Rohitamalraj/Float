import type { Queue, Worker } from 'bullmq';
import { evaluateSweep } from '@float/core';
import { buildSweepContext } from '../context.js';
import { logger } from '../logger.js';
import {
  QUEUE,
  connectionFor,
  makeWorker,
  sweepIdempotencyKey,
  type EvaluateJob,
  type ExecuteJob,
} from '../queues.js';
import { getBusiness } from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

/**
 * For one business: assemble its context, run the pure decision engine, and (if
 * it decided to act) enqueue an idempotent execute job.
 */
export function startEvaluateWorker(
  rt: AgentRuntime,
  executeQueue: Queue<ExecuteJob>,
): Worker<EvaluateJob> {
  return makeWorker<EvaluateJob>(QUEUE.evaluate, connectionFor(rt.redis), async (job) => {
    const { businessId, reason } = job.data;
    const log = logger.child({ worker: 'evaluate', businessId, trigger: reason });

    const business = await getBusiness(rt.db, businessId);
    if (!business || business.status !== 'active') {
      log.debug({ status: business?.status }, 'business not active — skip');
      return;
    }

    const result = await buildSweepContext(
      { publicClient: rt.publicClient, db: rt.db, deployment: rt.deployment, params: rt.params },
      business,
    );
    if (!result.ok) {
      log.info({ skip: result.skip }, 'context incomplete — skip');
      return;
    }

    const decision = evaluateSweep(result.ctx);
    log.info(
      {
        action: decision.action,
        amount: decision.amount.toString(),
        why: decision.reason,
        policySource: result.policySource,
        detail: decision.detail,
      },
      'sweep decision',
    );
    if (decision.action === 'none') return;

    const direction: ExecuteJob['direction'] = decision.action === 'sweep_in' ? 'in' : 'out';
    const windowStartMs = result.ctx.now.getTime();
    const jobId = sweepIdempotencyKey(businessId, direction, windowStartMs);

    await executeQueue.add(
      'execute',
      {
        businessId,
        direction,
        amountUsdc: decision.amount.toString(),
        decisionReason: decision.reason,
        decisionDetail: decision.detail,
        windowStartMs,
      },
      { jobId },
    );
    log.info({ jobId, direction }, 'enqueued execute');
  });
}
