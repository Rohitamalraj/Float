import { CallPolicyVersion, ParamCondition } from '@zerodev/permissions/policies';
import { getAddress, parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { agentPermissionSpec, agentPolicySnapshot, buildAgentCallPolicy } from './policy.js';

const deployment = {
  sweepExecutor: getAddress('0x00000000000000000000000000000000000000e1'),
  usdc: getAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'),
  floatUstb: getAddress('0x00000000000000000000000000000000000000b2'),
};
const CAP = parseUnits('10000', 6);

describe('agentPermissionSpec', () => {
  const spec = agentPermissionSpec({ deployment, maxSweepPerTx: CAP });

  it('is exactly four permissions, all with zero value limit', () => {
    expect(spec).toHaveLength(4);
    for (const p of spec) expect(p.valueLimit).toBe(0n);
  });

  it('sweepIn: caps arg0 (usdcIn) at maxSweepPerTx, leaves minOut free', () => {
    const p = spec.find((x) => x.functionName === 'sweepIn')!;
    expect(p.target).toBe(deployment.sweepExecutor);
    expect(p.args).toEqual([{ condition: ParamCondition.LESS_THAN_OR_EQUAL, value: CAP }, null]);
  });

  it('sweepOut: target+selector only (amount bounded on-chain)', () => {
    const p = spec.find((x) => x.functionName === 'sweepOut')!;
    expect(p.target).toBe(deployment.sweepExecutor);
    expect(p.args).toEqual([null, null]);
  });

  it('USDC.approve: spender must equal the executor, amount ≤ cap', () => {
    const p = spec
      .filter((x) => x.functionName === 'approve')
      .find((x) => x.target === deployment.usdc)!;
    expect(p.args).toEqual([
      { condition: ParamCondition.EQUAL, value: deployment.sweepExecutor },
      { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: CAP },
    ]);
  });

  it('FloatUSTB.approve: spender must equal the executor, amount unbounded', () => {
    const p = spec
      .filter((x) => x.functionName === 'approve')
      .find((x) => x.target === deployment.floatUstb)!;
    expect(p.args).toEqual([
      { condition: ParamCondition.EQUAL, value: deployment.sweepExecutor },
      null,
    ]);
  });

  it('never targets anything but the executor and the two tokens', () => {
    const targets = new Set(spec.map((p) => p.target));
    expect(targets).toEqual(
      new Set([deployment.sweepExecutor, deployment.usdc, deployment.floatUstb]),
    );
  });
});

describe('buildAgentCallPolicy', () => {
  it('produces a V0.0.4 call policy', () => {
    const policy = buildAgentCallPolicy({ deployment, maxSweepPerTx: CAP });
    expect(policy.policyParams.type).toBe('call');
    expect(typeof policy.getPolicyData).toBe('function');
    expect(policy.getPolicyData()).toMatch(/^0x/);
  });
});

describe('agentPolicySnapshot', () => {
  it('records the cap and the allowed selectors', () => {
    const snap = agentPolicySnapshot({ deployment, maxSweepPerTx: CAP });
    expect(snap.callPolicyVersion).toBe(CallPolicyVersion.V0_0_4);
    expect(snap.maxSweepPerTx).toBe('10000000000');
    expect(snap.executor).toBe(deployment.sweepExecutor);
    expect(snap.allowedSelectors).toContain('FloatSweepExecutor.sweepIn(uint256,uint256)');
  });
});
