import { decodeFunctionData, getAddress, parseUnits, type Hex } from 'viem';
import { namehash } from 'viem/ens';
import { describe, expect, it } from 'vitest';
import type { ComplianceState, SweepPolicy } from '@float/core';
import { permissionedResolverAbi } from './abis.js';
import {
  encodeAuthorizeRecordRoleSplit,
  encodeSetComplianceRecords,
  encodeSetPolicyRecords,
  encodeSetSmartAccount,
  type ResolverRef,
} from './resolver.js';

const REF: ResolverRef = {
  resolver: getAddress('0x0000000000000000000000000000000000000099'),
  node: namehash('rosa-design.float.eth'),
};
const OWNER = getAddress('0x00000000000000000000000000000000000000a1');
const ORACLE = getAddress('0x00000000000000000000000000000000000000b2');

const POLICY: SweepPolicy = {
  bufferAmount: parseUnits('2000', 6),
  maxSweepPerTx: parseUnits('10000', 6),
  allowedProtocol: getAddress('0x00000000000000000000000000000000000000c3'),
  targetYieldToken: getAddress('0x00000000000000000000000000000000000000d4'),
};

function decodeMulticall(data: Hex): Array<{ functionName: string; args: readonly unknown[] }> {
  const outer = decodeFunctionData({ abi: permissionedResolverAbi, data });
  if (outer.functionName === 'multicall') {
    return (outer.args[0] as Hex[]).map((d) => {
      const inner = decodeFunctionData({ abi: permissionedResolverAbi, data: d });
      return { functionName: inner.functionName, args: inner.args ?? [] };
    });
  }
  return [{ functionName: outer.functionName, args: outer.args ?? [] }];
}

describe('encodeSetPolicyRecords', () => {
  it('writes the four policy keys as setText', () => {
    const inner = decodeMulticall(encodeSetPolicyRecords(REF, POLICY).data);
    expect(inner).toHaveLength(4);
    const keys = inner.map((c) => c.args[1]);
    expect(keys).toEqual([
      'float.buffer-amount',
      'float.max-sweep-per-tx',
      'float.allowed-protocols',
      'float.target-yield-token',
    ]);
    inner.forEach((c) => {
      expect(c.functionName).toBe('setText');
      expect(c.args[0]).toBe(REF.node);
    });
    expect(inner[0]!.args[2]).toBe('2000');
  });
});

describe('encodeSetComplianceRecords', () => {
  it('writes the compliance keys', () => {
    const state: ComplianceState = {
      kycStatus: 'verified',
      accreditation: 'accredited',
      kycVerifiedAt: new Date('2026-09-01T00:00:00Z'),
      allowlistId: 'float-ustb-1',
    };
    const inner = decodeMulticall(encodeSetComplianceRecords(REF, state).data);
    const keys = inner.map((c) => c.args[1]);
    expect(keys).toContain('float.kyc-status');
    expect(keys).toContain('float.accreditation');
    expect(keys).toContain('float.kyc-verified-at');
  });
});

describe('encodeAuthorizeRecordRoleSplit', () => {
  it('grants the owner the 4 policy keys and the oracle the 4 compliance keys', () => {
    const inner = decodeMulticall(
      encodeAuthorizeRecordRoleSplit(REF, {
        ensName: 'rosa-design.float.eth',
        ownerKey: OWNER,
        oracleKey: ORACLE,
      }).data,
    );
    expect(inner).toHaveLength(8);
    inner.forEach((c) => {
      expect(c.functionName).toBe('authorizeTextRoles');
      expect(c.args[3]).toBe(true); // grant
    });

    const forOwner = inner.filter((c) => c.args[2] === OWNER).map((c) => c.args[1]);
    const forOracle = inner.filter((c) => c.args[2] === ORACLE).map((c) => c.args[1]);
    expect(forOwner).toEqual([
      'float.buffer-amount',
      'float.max-sweep-per-tx',
      'float.allowed-protocols',
      'float.target-yield-token',
    ]);
    expect(forOracle).toEqual([
      'float.kyc-status',
      'float.allowlist-id',
      'float.kyc-verified-at',
      'float.accreditation',
    ]);
  });
});

describe('encodeSetSmartAccount', () => {
  it('is a single setAddr(node, account)', () => {
    const call = encodeSetSmartAccount(REF, OWNER);
    const d = decodeFunctionData({ abi: permissionedResolverAbi, data: call.data });
    expect(d.functionName).toBe('setAddr');
    expect(d.args).toEqual([REF.node, OWNER]);
  });
});
