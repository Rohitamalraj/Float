import { getAddress, stringToHex, type Hex } from 'viem';
import type { Worker } from 'bullmq';
import { floatContracts } from '@float/contracts-sdk';
import { encodeSetComplianceRecords } from '@float/ens';
import { logger } from '../logger.js';
import { QUEUE, connectionFor, makeWorker } from '../queues.js';
import {
  appendAudit,
  insertOnchainTx,
  markReviewAttested,
  pendingApprovedReviews,
  upsertCompliance,
} from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

/** Default issuer allowlist id Float attests against (see docs/mocked-vs-real.md). */
const FLOAT_ALLOWLIST_ID = stringToHex('float-ustb-1', { size: 32 });

/**
 * Drains the admin-approved KYC review queue (the `ManualAdminAdapter` stand-in
 * for a live issuer): writes the on-chain attestation and mirrors it into the
 * ENS compliance records, both signed by the compliance-oracle key.
 */
export function startOracleSyncWorker(rt: AgentRuntime): Worker {
  return makeWorker(QUEUE.oracleSync, connectionFor(rt.redis), async () => {
    const rows = await pendingApprovedReviews(rt.db);
    if (rows.length === 0) return;
    const log = logger.child({ worker: 'oracle-sync' });

    const contracts = floatContracts(rt.deployment, {
      public: rt.publicClient,
      wallet: rt.walletClients.oracle,
    });

    for (const { review, business } of rows) {
      if (!business.smartAccountAddress) {
        log.warn({ businessId: business.id }, 'approved review but no smart account — deferring');
        continue;
      }
      const account = getAddress(business.smartAccountAddress);
      const verifiedAt = new Date();

      // 1. on-chain attestation (KycStatus.Verified = 1, no expiry)
      const attestationTx = await contracts.complianceRegistry.write.setAttestation(
        [account, 1, false, 0n, FLOAT_ALLOWLIST_ID],
        { account: rt.signers.oracle.account, chain: rt.chain },
      );

      // 2. mirror into the ENS compliance records
      let ensTx: `0x${string}` | undefined;
      if (rt.ensDeployment && business.ensResolver && business.ensNode) {
        const call = encodeSetComplianceRecords(
          { resolver: getAddress(business.ensResolver), node: business.ensNode as Hex },
          {
            kycStatus: 'verified',
            accreditation: 'unknown',
            kycVerifiedAt: verifiedAt,
            allowlistId: 'float-ustb-1',
          },
        );
        ensTx = await rt.walletClients.oracle.sendTransaction({
          account: rt.signers.oracle.account,
          chain: rt.chain,
          to: call.to,
          data: call.data,
          value: 0n,
        });
      }

      // 3. bookkeeping
      await markReviewAttested(rt.db, review.id, attestationTx);
      await upsertCompliance(rt.db, business.id, {
        kycStatus: 'verified',
        source: 'manual_admin',
        allowlistId: 'float-ustb-1',
        verifiedAt,
        registrySyncedAt: verifiedAt,
        ensSyncedAt: ensTx ? verifiedAt : undefined,
      });
      await insertOnchainTx(rt.db, {
        businessId: business.id,
        kind: 'oracle_attestation',
        signerRole: 'oracle',
        chainId: rt.deployment.chainId,
        status: 'confirmed',
        txHash: attestationTx,
        payload: { account, ensTx: ensTx ?? null, reviewId: review.id },
        confirmedAt: verifiedAt,
      });
      await appendAudit(rt.db, {
        actorType: 'oracle',
        actorId: rt.signers.oracle.address,
        businessId: business.id,
        action: 'compliance.verified',
        target: account,
        after: { attestationTx, ensTx: ensTx ?? null },
      });
      log.info({ businessId: business.id, attestationTx, ensTx }, 'attestation written + mirrored');
    }
  });
}
