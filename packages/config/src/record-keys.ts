/**
 * ENS text-record keys that carry Float's policy and compliance state on a
 * business's name (e.g. `rosa-design.float.eth`).
 *
 * Write access is split at the resolver via Enhanced Access Control:
 *   - POLICY_KEYS      → business owner key only
 *   - COMPLIANCE_KEYS  → Float compliance-oracle key only
 *
 * See `docs/security-model.md` (Layer 2) and `packages/ens`.
 */

export const POLICY_KEYS = {
  /** Working-capital buffer to always keep liquid, in USDC (decimal string, e.g. "2000"). */
  bufferAmount: 'float.buffer-amount',
  /** Hard ceiling on a single sweep, in USDC (decimal string). Mirrors the Layer 1 cap. */
  maxSweepPerTx: 'float.max-sweep-per-tx',
  /** Address of the PermissionsAdapter / pool the agent may route through. */
  allowedProtocols: 'float.allowed-protocols',
  /** Address of the yield token the buffer overflow is swept into (e.g. FloatUSTB). */
  targetYieldToken: 'float.target-yield-token',
} as const;

export const COMPLIANCE_KEYS = {
  /** "verified" | "pending" | "revoked" | "expired". */
  kycStatus: 'float.kyc-status',
  /** Opaque issuer allowlist identifier, e.g. "superstate-ustb-1". */
  allowlistId: 'float.allowlist-id',
  /** ISO-8601 timestamp of the most recent successful verification. */
  kycVerifiedAt: 'float.kyc-verified-at',
  /** "accredited" | "non-accredited" | "unknown" — gates private-fund venues. */
  accreditation: 'float.accreditation',
} as const;

export type PolicyKey = (typeof POLICY_KEYS)[keyof typeof POLICY_KEYS];
export type ComplianceKey = (typeof COMPLIANCE_KEYS)[keyof typeof COMPLIANCE_KEYS];
export type FloatRecordKey = PolicyKey | ComplianceKey;

export const ALL_POLICY_KEYS: readonly PolicyKey[] = Object.values(POLICY_KEYS);
export const ALL_COMPLIANCE_KEYS: readonly ComplianceKey[] = Object.values(COMPLIANCE_KEYS);
export const ALL_FLOAT_RECORD_KEYS: readonly FloatRecordKey[] = [
  ...ALL_POLICY_KEYS,
  ...ALL_COMPLIANCE_KEYS,
];

export type KycStatus = 'verified' | 'pending' | 'revoked' | 'expired';
export type Accreditation = 'accredited' | 'non-accredited' | 'unknown';

export function isPolicyKey(key: string): key is PolicyKey {
  return (ALL_POLICY_KEYS as readonly string[]).includes(key);
}

export function isComplianceKey(key: string): key is ComplianceKey {
  return (ALL_COMPLIANCE_KEYS as readonly string[]).includes(key);
}
