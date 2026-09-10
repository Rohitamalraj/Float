import { decodeFunctionData, getAddress, parseUnits, zeroHash } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  erc20Abi,
  floatComplianceRegistryAbi,
  floatPolicyViewAbi,
  floatSweepExecutorAbi,
} from './abis/index.js';
import {
  encodeRevokeAttestation,
  encodeSetAttestation,
  encodeSetPolicy,
  encodeSweepIn,
  encodeSweepOut,
} from './encode.js';

const EXECUTOR = getAddress('0x00000000000000000000000000000000000000e1');
const USDC = getAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238');
const USTB = getAddress('0x00000000000000000000000000000000000000b2');
const REGISTRY = getAddress('0x0000000000000000000000000000000000000010');

describe('encodeSweepIn', () => {
  it('produces [approve(executor, amount), sweepIn(amount, minOut)]', () => {
    const amount = parseUnits('6000', 6);
    const [approve, sweep] = encodeSweepIn({
      executor: EXECUTOR,
      usdc: USDC,
      usdcIn: amount,
      minTokenOut: 123n,
    });

    expect(approve.to).toBe(USDC);
    expect(approve.value).toBe(0n);
    const a = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    expect(a.functionName).toBe('approve');
    expect(a.args).toEqual([EXECUTOR, amount]);

    expect(sweep.to).toBe(EXECUTOR);
    const s = decodeFunctionData({ abi: floatSweepExecutorAbi, data: sweep.data });
    expect(s.functionName).toBe('sweepIn');
    expect(s.args).toEqual([amount, 123n]);
  });
});

describe('encodeSweepOut', () => {
  it('produces [approve(executor, tokenIn), sweepOut(tokenIn, minUsdcOut)]', () => {
    const [approve, sweep] = encodeSweepOut({
      executor: EXECUTOR,
      floatUstb: USTB,
      tokenIn: 999n,
      minUsdcOut: 5n,
    });
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data }).args).toEqual([
      EXECUTOR,
      999n,
    ]);
    const s = decodeFunctionData({ abi: floatSweepExecutorAbi, data: sweep.data });
    expect(s.functionName).toBe('sweepOut');
    expect(s.args).toEqual([999n, 5n]);
  });
});

describe('oracle / policy encoders', () => {
  it('encodeSetAttestation round-trips', () => {
    const call = encodeSetAttestation({
      registry: REGISTRY,
      account: EXECUTOR,
      status: 1,
      accredited: true,
      expiresAt: 0n,
      allowlistId: zeroHash,
    });
    const d = decodeFunctionData({ abi: floatComplianceRegistryAbi, data: call.data });
    expect(d.functionName).toBe('setAttestation');
    expect(d.args).toEqual([EXECUTOR, 1, true, 0n, zeroHash]);
  });

  it('encodeRevokeAttestation targets revoke(account)', () => {
    const d = decodeFunctionData({
      abi: floatComplianceRegistryAbi,
      data: encodeRevokeAttestation(REGISTRY, EXECUTOR).data,
    });
    expect(d.functionName).toBe('revoke');
    expect(d.args).toEqual([EXECUTOR]);
  });

  it('encodeSetPolicy carries buffer + cap', () => {
    const call = encodeSetPolicy({
      policyView: REGISTRY,
      account: EXECUTOR,
      bufferAmount: parseUnits('2000', 6),
      maxSweepPerTx: parseUnits('10000', 6),
    });
    expect(call.value).toBe(0n);
    const d = decodeFunctionData({ abi: floatPolicyViewAbi, data: call.data });
    expect(d.functionName).toBe('setPolicy');
    expect(d.args).toEqual([EXECUTOR, parseUnits('2000', 6), parseUnits('10000', 6)]);
  });
});
