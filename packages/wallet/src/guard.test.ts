import { encodeFunctionData, getAddress, parseUnits, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { erc20Abi, encodeApprove, encodeSweepIn, encodeSweepOut } from '@float/contracts-sdk';
import { agentGuard, assertBatchInPolicy, checkBatchInPolicy, PolicyGuardError } from './guard.js';
import { agentPermissionSpec } from './policy.js';

const deployment = {
  sweepExecutor: getAddress('0x00000000000000000000000000000000000000e1'),
  usdc: getAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'),
  floatUstb: getAddress('0x00000000000000000000000000000000000000b2'),
};
const CAP = parseUnits('10000', 6);
const spec = agentPermissionSpec({ deployment, maxSweepPerTx: CAP });
const guard = agentGuard({ deployment, maxSweepPerTx: CAP });

const ATTACKER = getAddress('0x000000000000000000000000000000000000dead');

describe('guard — in-policy batches pass', () => {
  it('sweep-in at half the cap', () => {
    const calls = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: CAP / 2n,
      minTokenOut: 1n,
    });
    expect(checkBatchInPolicy(spec, calls)).toEqual({ ok: true });
    expect(() => assertBatchInPolicy(spec, calls)).not.toThrow();
  });

  it('sweep-in exactly at the cap (boundary)', () => {
    const calls = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: CAP,
      minTokenOut: 0n,
    });
    expect(guard.checkBatch(calls)).toEqual({ ok: true });
  });

  it('sweep-out (share amount is unconstrained by Layer 1)', () => {
    const calls = encodeSweepOut({
      executor: deployment.sweepExecutor,
      floatUstb: deployment.floatUstb,
      tokenIn: parseUnits('999999', 18),
      minUsdcOut: 1n,
    });
    expect(guard.checkBatch(calls)).toEqual({ ok: true });
  });
});

describe('guard — out-of-policy calls are rejected', () => {
  it('sweep-in over the cap → arg-above-max', () => {
    const calls = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: CAP + 1n,
      minTokenOut: 0n,
    });
    const res = checkBatchInPolicy(spec, calls);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    // the approve leg (call 0) trips first — it also carries the over-cap amount
    expect(res.violation.code).toBe('arg-above-max');
    expect(res.violation.callIndex).toBe(0);
  });

  it('bare executor.sweepIn over the cap → arg-above-max on arg 0', () => {
    const call = {
      to: deployment.sweepExecutor,
      value: 0n,
      data: encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'sweepIn',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'usdcIn', type: 'uint256' },
              { name: 'minTokenOut', type: 'uint256' },
            ],
            outputs: [],
          },
        ] as const,
        functionName: 'sweepIn',
        args: [CAP + 1n, 0n],
      }),
    };
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation).toMatchObject({ code: 'arg-above-max', callIndex: 0, argIndex: 0 });
  });

  it('USDC.approve to a spender other than the executor → arg-equal-mismatch', () => {
    const call = encodeApprove(deployment.usdc, ATTACKER, 1n);
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation).toMatchObject({ code: 'arg-equal-mismatch', argIndex: 0 });
  });

  it('USDC.approve over the cap → arg-above-max', () => {
    const call = encodeApprove(deployment.usdc, deployment.sweepExecutor, CAP + 1n);
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation).toMatchObject({ code: 'arg-above-max', argIndex: 1 });
  });

  it('unlimited USDC.approve to the executor → arg-above-max', () => {
    const maxUint = (1n << 256n) - 1n;
    const call = encodeApprove(deployment.usdc, deployment.sweepExecutor, maxUint);
    expect(checkBatchInPolicy(spec, [call]).ok).toBe(false);
  });

  it('FloatUSTB.approve to a spender other than the executor → arg-equal-mismatch', () => {
    const call = encodeApprove(deployment.floatUstb, ATTACKER, 1n);
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.code).toBe('arg-equal-mismatch');
  });

  it('a call to an arbitrary contract → target-not-allowed', () => {
    const call = { to: ATTACKER, value: 0n, data: '0xdeadbeef' as Hex };
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.code).toBe('target-not-allowed');
  });

  it('a permitted target with an unknown selector → selector-not-allowed', () => {
    // erc20 transfer() to USDC — USDC is a permitted target, transfer is not a permitted selector
    const call = {
      to: deployment.usdc,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ATTACKER, 1n] }),
    };
    const res = checkBatchInPolicy(spec, [call]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.code).toBe('selector-not-allowed');
  });

  it('a non-zero value on an otherwise-permitted call → value-not-allowed', () => {
    const [, sweep] = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: 1n,
      minTokenOut: 0n,
    });
    const res = checkBatchInPolicy(spec, [{ ...sweep, value: 1n }]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.code).toBe('value-not-allowed');
  });

  it('matching selector but truncated calldata → decode-failed', () => {
    const [, sweep] = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: 1n,
      minTokenOut: 0n,
    });
    const truncated = { ...sweep, data: sweep.data.slice(0, 20) as Hex };
    const res = checkBatchInPolicy(spec, [truncated]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.code).toBe('decode-failed');
  });

  it('a valid leg followed by an out-of-policy leg → reports the second call', () => {
    const [approve] = encodeSweepIn({
      executor: deployment.sweepExecutor,
      usdc: deployment.usdc,
      usdcIn: 1n,
      minTokenOut: 0n,
    });
    const evil = encodeApprove(deployment.usdc, ATTACKER, 1n);
    const res = checkBatchInPolicy(spec, [approve, evil]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.violation.callIndex).toBe(1);
  });

  it('assertBatchInPolicy throws PolicyGuardError carrying the violation', () => {
    const call = encodeApprove(deployment.usdc, ATTACKER, 1n);
    try {
      assertBatchInPolicy(spec, [call]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyGuardError);
      expect((err as PolicyGuardError).violation.code).toBe('arg-equal-mismatch');
    }
  });
});
