import type { Worker } from 'bullmq';
import { getAddress } from 'viem';
import { getSubregistry, planBusinessProvisioning } from '@float/ens';
import { predictBusinessAccountAddress } from '@float/wallet';
import { logger } from '../logger.js';
import { QUEUE, connectionFor, makeWorker } from '../queues.js';
import { businessesAwaitingProvisioning, markBusinessProvisioned } from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

/**
 * Auto-provisions ENS for newly onboarded businesses: computes their Kernel
 * v3 smart account address (no signature needed — deterministic from the
 * owner's address alone), mints the ENS subname, deploys a Float-controlled
 * resolver, and splits owner/oracle text-record write roles. Every step here
 * is provisioner-signed. Float never holds the owner key, so the initial
 * policy (owner-signed ENS records) and the agent session-key grant
 * (owner-signed, off-chain) happen afterward, in the dashboard, once the
 * owner can see their account address.
 */
export function startProvisionWorker(rt: AgentRuntime): Worker {
  return makeWorker(QUEUE.provision, connectionFor(rt.redis), async () => {
    if (!rt.ensDeployment) return;
    const log = logger.child({ worker: 'provision' });
    const pending = await businessesAwaitingProvisioning(rt.db);
    if (pending.length === 0) return;

    const subregistry = await getSubregistry(rt.publicClient, rt.ensDeployment.registry, 'float');

    for (const biz of pending) {
      const ownerKey = getAddress(biz.ownerKeyAddress);
      const smartAccount = await predictBusinessAccountAddress({
        publicClient: rt.publicClient,
        ownerKeyAddress: ownerKey,
        runtime: rt.wallet,
      });

      const plan = planBusinessProvisioning({
        deployment: rt.ensDeployment,
        ensName: biz.ensName,
        parentRegistry: subregistry,
        smartAccount,
        provisioner: rt.signers.provisioner.address,
        ownerKey,
        oracleKey: rt.signers.oracle.address,
      });

      for (const step of plan.steps) {
        for (const call of step.calls) {
          const hash = await rt.walletClients.provisioner.sendTransaction({
            account: rt.signers.provisioner.account,
            chain: rt.chain,
            to: call.to,
            data: call.data,
            value: call.value,
          });
          const receipt = await rt.publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') {
            throw new Error(
              `provisioning step failed for ${biz.ensName}: ${step.description} (${hash})`,
            );
          }
        }
      }

      await markBusinessProvisioned(rt.db, biz.id, {
        smartAccountAddress: smartAccount,
        ensResolver: plan.resolver,
      });
      log.info(
        { businessId: biz.id, ensName: biz.ensName, smartAccount, resolver: plan.resolver },
        'ENS provisioned',
      );
    }
  });
}
