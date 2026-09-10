import { getAddress, http, type Hex } from 'viem';
import type { Worker } from 'bullmq';
import { requireEnv } from '@float/config';
import { encodeSweepIn, encodeSweepOut, floatContracts } from '@float/contracts-sdk';
import { agentGuard, PolicyGuardError, restoreSessionKeyClient } from '@float/wallet';
import { quoteSweepMinOut } from '@float/uniswap';
import { logger } from '../logger.js';
import {
  QUEUE,
  connectionFor,
  makeWorker,
  sweepIdempotencyKey,
  type ExecuteJob,
} from '../queues.js';
import {
  appendAudit,
  findSweepByIdempotencyKey,
  getActiveSessionKey,
  getBusiness,
  insertOnchainTx,
  insertSweep,
  markOnchainTx,
  updateSweep,
} from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

/**
 * Build the `[approve, sweep]` batch, sign it with the restored session key, and
 * submit it as a UserOperation. Idempotent on `<businessId>:<direction>:<hour>`.
 */
export function startExecuteWorker(rt: AgentRuntime): Worker<ExecuteJob> {
  return makeWorker<ExecuteJob>(
    QUEUE.execute,
    connectionFor(rt.redis),
    async (job) => {
      const { businessId, direction, amountUsdc, decisionReason, decisionDetail, windowStartMs } =
        job.data;
      const key = sweepIdempotencyKey(businessId, direction, windowStartMs);
      const log = logger.child({ worker: 'execute', businessId, key, direction });

      const existing = await findSweepByIdempotencyKey(rt.db, key);
      if (existing && existing.status !== 'failed') {
        log.info({ status: existing.status }, 'sweep already recorded — skip');
        return;
      }

      const business = await getBusiness(rt.db, businessId);
      if (!business?.smartAccountAddress)
        throw new Error(`business ${businessId} has no smart account`);
      const smartAccount = getAddress(business.smartAccountAddress);

      const sk = await getActiveSessionKey(rt.db, businessId);
      if (!sk) throw new Error(`no active session key for business ${businessId}`);

      const contracts = floatContracts(rt.deployment, { public: rt.publicClient });
      const amount = BigInt(amountUsdc);

      let calls: readonly { to: `0x${string}`; data: Hex; value: bigint }[];
      let minOut: bigint;
      if (direction === 'in') {
        const q = await quoteSweepMinOut({
          publicClient: rt.publicClient,
          deployment: rt.deployment,
          direction: 'in',
          amountIn: amount,
          slippageBps: rt.params.slippageBps,
          venue: rt.venue,
        });
        minOut = q.minOut;
        calls = encodeSweepIn({
          executor: rt.deployment.sweepExecutor,
          usdc: rt.deployment.usdc,
          usdcIn: amount,
          minTokenOut: minOut,
        });
      } else {
        // decision amount is a USDC target; the executor takes FloatUSTB shares.
        const shares = await contracts.floatUstb.read.convertToShares([amount]);
        const q = await quoteSweepMinOut({
          publicClient: rt.publicClient,
          deployment: rt.deployment,
          direction: 'out',
          amountIn: shares,
          slippageBps: rt.params.slippageBps,
          venue: rt.venue,
        });
        minOut = q.minOut;
        calls = encodeSweepOut({
          executor: rt.deployment.sweepExecutor,
          floatUstb: rt.deployment.floatUstb,
          tokenIn: shares,
          minUsdcOut: minOut,
        });
      }

      const sweep =
        existing ??
        (await insertSweep(rt.db, {
          businessId,
          direction,
          amount: amountUsdc,
          minOut: minOut.toString(),
          decisionReason,
          decisionDetail,
          idempotencyKey: key,
          status: 'pending',
        }));

      // Pre-flight: the ZeroDev call policy is the authoritative gate, but a bug
      // in our own batch construction would just burn a bundler round-trip and
      // fail at validation. Interpret the same permission spec locally first.
      try {
        agentGuard({
          deployment: rt.deployment,
          maxSweepPerTx: BigInt(sk.policySnapshot.maxSweepPerTx),
        }).assertBatch(calls);
      } catch (err) {
        if (!(err instanceof PolicyGuardError)) throw err;
        await updateSweep(rt.db, sweep.id, {
          status: 'failed',
          error: `out-of-policy batch: ${err.violation.code} — ${err.violation.message}`,
        });
        await appendAudit(rt.db, {
          actorType: 'agent',
          actorId: rt.signers.agentSession.address,
          businessId,
          action: `sweep_${direction}.blocked`,
          target: smartAccount,
          after: { violation: err.violation.code, message: err.violation.message },
        });
        log.error({ violation: err.violation }, 'sweep batch failed the local policy guard — not submitting');
        throw err;
      }

      const client = await restoreSessionKeyClient({
        publicClient: rt.publicClient,
        chain: rt.chain,
        serializedApproval: sk.serializedApproval,
        agentSigner: rt.signers.agentSession.account,
        bundlerTransport: http(
          requireEnv('ZERODEV_BUNDLER_RPC', 'submit sweep UserOperations', rt.env),
        ),
        runtime: rt.wallet,
      });

      const userOpHash = await client.sendUserOperation({
        calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })),
      });
      await updateSweep(rt.db, sweep.id, {
        userOpHash,
        status: 'submitted',
        submittedAt: new Date(),
      });
      const ledger = await insertOnchainTx(rt.db, {
        businessId,
        kind: 'sweep',
        signerRole: 'agent_session',
        chainId: rt.deployment.chainId,
        status: 'pending',
        payload: { direction, amountUsdc, minOut: minOut.toString(), userOpHash },
      });
      log.info({ userOpHash }, 'UserOperation submitted');

      const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
      const txHash = receipt.receipt.transactionHash;
      const ok = receipt.success;

      await updateSweep(rt.db, sweep.id, {
        txHash,
        status: ok ? 'confirmed' : 'failed',
        confirmedAt: new Date(),
        gasUsed: receipt.actualGasUsed.toString(),
        error: ok ? null : 'UserOperation reverted',
      });
      await markOnchainTx(rt.db, ledger.id, {
        txHash,
        status: ok ? 'confirmed' : 'failed',
        confirmedAt: new Date(),
      });
      await appendAudit(rt.db, {
        actorType: 'agent',
        actorId: rt.signers.agentSession.address,
        businessId,
        action: ok ? `sweep_${direction}.confirmed` : `sweep_${direction}.failed`,
        target: smartAccount,
        after: { txHash, amountUsdc, minOut: minOut.toString() },
      });

      if (!ok) throw new Error(`sweep ${key} reverted on-chain (${txHash})`);
      log.info({ txHash }, `sweep ${direction} confirmed`);
    },
    { concurrency: rt.params.executeConcurrency },
  );
}
