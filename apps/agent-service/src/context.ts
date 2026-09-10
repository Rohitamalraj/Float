import { getAddress, type Hex } from 'viem';
import {
  floatContracts,
  readAttestation,
  readVaultValuation,
  type FloatDeployment,
} from '@float/contracts-sdk';
import type { Accreditation, KycStatus } from '@float/config';
import type { ComplianceState, Obligation, SweepContext, SweepPolicy } from '@float/core';
import type { Business, Database } from '@float/db';
import { readParsedFloatState } from '@float/ens';
import type { PublicClient } from 'viem';
import { getPolicyMirror, upcomingObligations } from './repo.js';
import type { AgentParams } from './runtime.js';

export interface BuildContextDeps {
  publicClient: PublicClient;
  db: Database;
  deployment: FloatDeployment;
  params: AgentParams;
  now?: Date;
}

export type ContextResult =
  | { ok: true; ctx: SweepContext; smartAccount: `0x${string}`; policySource: 'ens' | 'mirror' }
  | { ok: false; skip: string };

export function toComplianceState(a: Awaited<ReturnType<typeof readAttestation>>): ComplianceState {
  const kycStatus: KycStatus = a.status === 'none' ? 'pending' : a.status;
  const accreditation: Accreditation = a.accredited ? 'accredited' : 'unknown';
  return {
    kycStatus,
    accreditation,
    kycVerifiedAt: a.verifiedAt,
    allowlistId: a.allowlistId,
  };
}

export function mirrorToPolicy(
  row: Awaited<ReturnType<typeof getPolicyMirror>>,
): SweepPolicy | null {
  if (!row) return null;
  return {
    bufferAmount: BigInt(row.bufferAmount),
    maxSweepPerTx: BigInt(row.maxSweepPerTx),
    allowedProtocol: getAddress(row.allowedProtocol),
    targetYieldToken: getAddress(row.targetYieldToken),
  };
}

/**
 * Assemble the {@link SweepContext} for one business from chain + DB state.
 * Policy comes from the ENS records when available (source of truth), otherwise
 * the on-chain-synced DB mirror.
 */
export async function buildSweepContext(
  deps: BuildContextDeps,
  business: Business,
): Promise<ContextResult> {
  if (!business.smartAccountAddress)
    return { ok: false, skip: 'business has no smart account yet' };
  const smartAccount = getAddress(business.smartAccountAddress);
  const now = deps.now ?? new Date();

  const contracts = floatContracts(deps.deployment, { public: deps.publicClient });

  const [attestation, usdcBalance, ustbBalance] = await Promise.all([
    readAttestation(contracts.complianceRegistry, smartAccount),
    contracts.usdc.read.balanceOf([smartAccount]),
    contracts.floatUstb.read.balanceOf([smartAccount]),
  ]);

  let policy: SweepPolicy | null = null;
  let policySource: 'ens' | 'mirror' = 'mirror';
  if (business.ensResolver && business.ensNode) {
    const parsed = await readParsedFloatState(deps.publicClient, {
      resolver: getAddress(business.ensResolver),
      node: business.ensNode as Hex,
    });
    policy = parsed.policy;
    if (policy) policySource = 'ens';
  }
  if (!policy) policy = mirrorToPolicy(await getPolicyMirror(deps.db, business.id));
  if (!policy) return { ok: false, skip: 'no policy configured (ENS + mirror both empty)' };

  const valuation = await readVaultValuation(contracts.floatUstb, ustbBalance);

  const horizon = new Date(now.getTime() + deps.params.sweepOutLookaheadMs);
  const obligationRows = await upcomingObligations(deps.db, business.id, horizon);
  const obligations: Obligation[] = obligationRows.map((o) => ({
    id: o.id,
    amount: BigInt(o.amount),
    dueAt: o.dueAt,
  }));

  const ctx: SweepContext = {
    now,
    stablecoinBalance: usdcBalance,
    yieldPositionValue: valuation.redeemable,
    policy,
    compliance: toComplianceState(attestation),
    upcomingObligations: obligations,
    lookaheadMs: deps.params.sweepOutLookaheadMs,
    maxComplianceAgeMs: deps.params.maxComplianceAgeMs,
    minSweepAmount: deps.params.minSweepUsdc,
  };

  return { ok: true, ctx, smartAccount, policySource };
}
