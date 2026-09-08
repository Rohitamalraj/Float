import { formatUnits, getAddress, parseUnits, type Address } from 'viem';
import { COMPLIANCE_KEYS, POLICY_KEYS, type Accreditation, type KycStatus } from '@float/config';
import type { ComplianceState, SweepPolicy } from './types.js';
import { USDC_DECIMALS } from './types.js';

export class RecordParseError extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`ENS record ${key}: ${reason}`);
    this.name = 'RecordParseError';
  }
}

function requireRecord(records: Record<string, string | undefined>, key: string): string {
  const v = records[key];
  if (v === undefined || v.trim() === '') throw new RecordParseError(key, 'missing');
  return v.trim();
}

function parseUsdc(key: string, raw: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new RecordParseError(key, `not a USDC amount: "${raw}"`);
  }
  return parseUnits(raw, USDC_DECIMALS);
}

function parseAddress(key: string, raw: string): Address {
  try {
    return getAddress(raw);
  } catch {
    throw new RecordParseError(key, `not an address: "${raw}"`);
  }
}

const KYC_STATUSES: readonly KycStatus[] = ['verified', 'pending', 'revoked', 'expired'];
const ACCREDITATIONS: readonly Accreditation[] = ['accredited', 'non-accredited', 'unknown'];

export function parsePolicyRecords(records: Record<string, string | undefined>): SweepPolicy {
  return {
    bufferAmount: parseUsdc(
      POLICY_KEYS.bufferAmount,
      requireRecord(records, POLICY_KEYS.bufferAmount),
    ),
    maxSweepPerTx: parseUsdc(
      POLICY_KEYS.maxSweepPerTx,
      requireRecord(records, POLICY_KEYS.maxSweepPerTx),
    ),
    allowedProtocol: parseAddress(
      POLICY_KEYS.allowedProtocols,
      requireRecord(records, POLICY_KEYS.allowedProtocols),
    ),
    targetYieldToken: parseAddress(
      POLICY_KEYS.targetYieldToken,
      requireRecord(records, POLICY_KEYS.targetYieldToken),
    ),
  };
}

export function parseComplianceRecords(
  records: Record<string, string | undefined>,
): ComplianceState {
  const statusRaw = (records[COMPLIANCE_KEYS.kycStatus] ?? 'pending').trim() as KycStatus;
  if (!KYC_STATUSES.includes(statusRaw)) {
    throw new RecordParseError(COMPLIANCE_KEYS.kycStatus, `unknown status "${statusRaw}"`);
  }
  const accRaw = (records[COMPLIANCE_KEYS.accreditation] ?? 'unknown').trim() as Accreditation;
  if (!ACCREDITATIONS.includes(accRaw)) {
    throw new RecordParseError(COMPLIANCE_KEYS.accreditation, `unknown value "${accRaw}"`);
  }
  const verifiedRaw = records[COMPLIANCE_KEYS.kycVerifiedAt]?.trim();
  let kycVerifiedAt: Date | undefined;
  if (verifiedRaw) {
    const d = new Date(verifiedRaw);
    if (Number.isNaN(d.getTime())) {
      throw new RecordParseError(COMPLIANCE_KEYS.kycVerifiedAt, `not a date: "${verifiedRaw}"`);
    }
    kycVerifiedAt = d;
  }
  return {
    kycStatus: statusRaw,
    accreditation: accRaw,
    kycVerifiedAt,
    allowlistId: records[COMPLIANCE_KEYS.allowlistId]?.trim() || undefined,
  };
}

/** Inverse of {@link parsePolicyRecords} — for writing owner policy updates. */
export function serializePolicyRecords(policy: SweepPolicy): Record<string, string> {
  return {
    [POLICY_KEYS.bufferAmount]: formatUnits(policy.bufferAmount, USDC_DECIMALS),
    [POLICY_KEYS.maxSweepPerTx]: formatUnits(policy.maxSweepPerTx, USDC_DECIMALS),
    [POLICY_KEYS.allowedProtocols]: getAddress(policy.allowedProtocol),
    [POLICY_KEYS.targetYieldToken]: getAddress(policy.targetYieldToken),
  };
}

/** Inverse of {@link parseComplianceRecords} — for the compliance-oracle writer. */
export function serializeComplianceRecords(state: ComplianceState): Record<string, string> {
  const out: Record<string, string> = {
    [COMPLIANCE_KEYS.kycStatus]: state.kycStatus,
    [COMPLIANCE_KEYS.accreditation]: state.accreditation,
  };
  if (state.kycVerifiedAt) {
    out[COMPLIANCE_KEYS.kycVerifiedAt] = state.kycVerifiedAt.toISOString();
  }
  if (state.allowlistId) {
    out[COMPLIANCE_KEYS.allowlistId] = state.allowlistId;
  }
  return out;
}
