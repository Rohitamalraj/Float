import { getAddress, type Hex } from 'viem';
import type { Worker } from 'bullmq';
import { floatContracts } from '@float/contracts-sdk';
import { readParsedFloatState } from '@float/ens';
import { logger } from '../logger.js';
import { QUEUE, connectionFor, makeWorker } from '../queues.js';
import { insertOnchainTx, listActiveBusinesses, upsertPolicyMirror } from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

/**
 * Keeps `FloatPolicyView` (the on-chain buffer / max-sweep mirror the executor
 * reads) equal to each business's ENS policy records. Signed by the
 * `POLICY_SYNC_ROLE` key. A no-op when nothing drifted.
 */
export function startPolicySyncWorker(rt: AgentRuntime): Worker {
  return makeWorker(QUEUE.policySync, connectionFor(rt.redis), async () => {
    if (!rt.ensDeployment) return;
    const log = logger.child({ worker: 'policy-sync' });
    const list = await listActiveBusinesses(rt.db);
    const contracts = floatContracts(rt.deployment, {
      public: rt.publicClient,
      wallet: rt.walletClients.policySync,
    });

    for (const b of list) {
      if (!b.smartAccountAddress || !b.ensResolver || !b.ensNode) continue;
      const account = getAddress(b.smartAccountAddress);

      const parsed = await readParsedFloatState(rt.publicClient, {
        resolver: getAddress(b.ensResolver),
        node: b.ensNode as Hex,
      });
      if (!parsed.policy) continue;
      const { bufferAmount, maxSweepPerTx, allowedProtocol, targetYieldToken } = parsed.policy;

      const onchain = await contracts.policyView.read.policyOf([account]);
      if (
        onchain.set &&
        onchain.bufferAmount === bufferAmount &&
        onchain.maxSweepPerTx === maxSweepPerTx
      ) {
        continue;
      }

      const txHash = await contracts.policyView.write.setPolicy(
        [account, bufferAmount, maxSweepPerTx],
        { account: rt.signers.policySync.account, chain: rt.chain },
      );
      await upsertPolicyMirror(rt.db, b.id, {
        bufferAmount: bufferAmount.toString(),
        maxSweepPerTx: maxSweepPerTx.toString(),
        allowedProtocol: getAddress(allowedProtocol),
        targetYieldToken: getAddress(targetYieldToken),
        ensSyncedAt: new Date(),
        policyViewSyncedAt: new Date(),
      });
      await insertOnchainTx(rt.db, {
        businessId: b.id,
        kind: 'policy_view_sync',
        signerRole: 'policy_sync',
        chainId: rt.deployment.chainId,
        status: 'confirmed',
        txHash,
        confirmedAt: new Date(),
        payload: { buffer: bufferAmount.toString(), maxSweep: maxSweepPerTx.toString() },
      });
      log.info({ businessId: b.id, txHash }, 'FloatPolicyView updated from ENS');
    }
  });
}
