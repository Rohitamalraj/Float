import type { Address, Hex } from 'viem';
import type { KycStatus } from '@float/config';
import type {
  ComplianceRegistryContract,
  FloatUstbContract,
  PolicyViewContract,
} from './contracts.js';

export type OnchainKycStatus = KycStatus | 'none';

/** IFloatComplianceRegistry.KycStatus enum order. */
const KYC_STATUS: readonly OnchainKycStatus[] = [
  'none',
  'verified',
  'pending',
  'revoked',
  'expired',
];

export interface Attestation {
  status: OnchainKycStatus;
  accredited: boolean;
  verifiedAt?: Date;
  expiresAt?: Date;
  allowlistId: Hex;
  /** Convenience: registry.isVerified() semantics (status verified && not expired). */
  isVerified: boolean;
}

function toDate(unixSeconds: bigint): Date | undefined {
  return unixSeconds === 0n ? undefined : new Date(Number(unixSeconds) * 1000);
}

export async function readAttestation(
  registry: ComplianceRegistryContract,
  account: Address,
): Promise<Attestation> {
  const [a, isVerified] = await Promise.all([
    registry.read.attestationOf([account]),
    registry.read.isVerified([account]),
  ]);
  return {
    status: KYC_STATUS[a.status] ?? 'none',
    accredited: a.accredited,
    verifiedAt: toDate(a.verifiedAt),
    expiresAt: toDate(a.expiresAt),
    allowlistId: a.allowlistId,
    isVerified,
  };
}

export interface AccountPolicy {
  bufferAmount: bigint;
  maxSweepPerTx: bigint;
}

/** Returns `null` when no policy has been synced on-chain for `account`. */
export async function readAccountPolicy(
  policyView: PolicyViewContract,
  account: Address,
): Promise<AccountPolicy | null> {
  const p = await policyView.read.policyOf([account]);
  if (!p.set) return null;
  return { bufferAmount: p.bufferAmount, maxSweepPerTx: p.maxSweepPerTx };
}

export interface VaultValuation {
  /** FloatUSTB shares (9 dp). */
  shares: bigint;
  /** USDC-equivalent value now (6 dp). */
  assets: bigint;
  /** USDC realisable on redemption right now (6 dp, after rounding). */
  redeemable: bigint;
}

export async function readVaultValuation(
  vault: FloatUstbContract,
  shares: bigint,
): Promise<VaultValuation> {
  if (shares === 0n) return { shares: 0n, assets: 0n, redeemable: 0n };
  const [assets, redeemable] = await Promise.all([
    vault.read.convertToAssets([shares]),
    vault.read.previewRedeem([shares]),
  ]);
  return { shares, assets, redeemable };
}
