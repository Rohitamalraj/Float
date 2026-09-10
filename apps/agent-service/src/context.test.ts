import { getAddress, parseUnits, zeroHash } from 'viem';
import { describe, expect, it } from 'vitest';
import { mirrorToPolicy, toComplianceState } from './context.js';

describe('toComplianceState', () => {
  it('maps a verified accredited attestation', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const c = toComplianceState({
      status: 'verified',
      accredited: true,
      verifiedAt: now,
      expiresAt: undefined,
      allowlistId: zeroHash,
      isVerified: true,
    });
    expect(c).toEqual({
      kycStatus: 'verified',
      accreditation: 'accredited',
      kycVerifiedAt: now,
      allowlistId: zeroHash,
    });
  });

  it("treats registry status 'none' as pending, non-accredited as unknown", () => {
    const c = toComplianceState({
      status: 'none',
      accredited: false,
      verifiedAt: undefined,
      expiresAt: undefined,
      allowlistId: zeroHash,
      isVerified: false,
    });
    expect(c.kycStatus).toBe('pending');
    expect(c.accreditation).toBe('unknown');
    expect(c.kycVerifiedAt).toBeUndefined();
  });
});

describe('mirrorToPolicy', () => {
  it('returns null when there is no mirror row', () => {
    expect(mirrorToPolicy(undefined)).toBeNull();
  });

  it('parses the numeric string columns to bigint and checksums addresses', () => {
    const row = {
      businessId: 'b',
      bufferAmount: parseUnits('2000', 6).toString(),
      maxSweepPerTx: parseUnits('10000', 6).toString(),
      allowedProtocol: '0x00000000000000000000000000000000000000a1',
      targetYieldToken: '0x00000000000000000000000000000000000000b2',
      ensSyncedAt: null,
      policyViewSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const p = mirrorToPolicy(row);
    expect(p).toEqual({
      bufferAmount: 2_000_000_000n,
      maxSweepPerTx: 10_000_000_000n,
      allowedProtocol: getAddress('0x00000000000000000000000000000000000000a1'),
      targetYieldToken: getAddress('0x00000000000000000000000000000000000000b2'),
    });
  });
});
