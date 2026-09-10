import { CallPolicyVersion, ParamCondition, toCallPolicy } from '@zerodev/permissions/policies';
import type { Policy } from '@zerodev/permissions';
import { erc20Abi, floatSweepExecutorAbi, type FloatDeployment } from '@float/contracts-sdk';
import type { Address } from 'viem';

export interface AgentPolicyParams {
  deployment: Pick<FloatDeployment, 'sweepExecutor' | 'usdc' | 'floatUstb'>;
  /** Hard per-transaction cap, USDC base units. Baked into the grant. */
  maxSweepPerTx: bigint;
}

/**
 * The exact set of calls the agent's session key is permitted to authorise —
 * Layer 1 of Float's security model. Nothing outside this list is signable.
 *
 *   FloatSweepExecutor.sweepIn(usdcIn, minOut)  — value 0, usdcIn ≤ maxSweepPerTx
 *   FloatSweepExecutor.sweepOut(tokenIn, minOut) — value 0 (amount bounded on-chain
 *                                                   by the executor + FloatPolicyView,
 *                                                   since tokenIn is in share units)
 *   USDC.approve(executor, amount)              — value 0, spender == executor, amount ≤ cap
 *   FloatUSTB.approve(executor, amount)         — value 0, spender == executor
 *                                                 (amount unbounded: the executor is the
 *                                                  only spender and is itself cap-gated)
 */
export function agentPermissionSpec(params: AgentPolicyParams) {
  const executor = params.deployment.sweepExecutor;
  const { maxSweepPerTx } = params;

  return [
    {
      target: executor,
      valueLimit: 0n,
      abi: floatSweepExecutorAbi,
      functionName: 'sweepIn',
      args: [{ condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxSweepPerTx }, null],
    },
    {
      target: executor,
      valueLimit: 0n,
      abi: floatSweepExecutorAbi,
      functionName: 'sweepOut',
      args: [null, null],
    },
    {
      target: params.deployment.usdc,
      valueLimit: 0n,
      abi: erc20Abi,
      functionName: 'approve',
      args: [
        { condition: ParamCondition.EQUAL, value: executor },
        { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxSweepPerTx },
      ],
    },
    {
      target: params.deployment.floatUstb,
      valueLimit: 0n,
      abi: erc20Abi,
      functionName: 'approve',
      args: [{ condition: ParamCondition.EQUAL, value: executor }, null],
    },
  ] as const;
}

/** Wrap {@link agentPermissionSpec} into a ZeroDev call policy (V0.0.4). */
export function buildAgentCallPolicy(params: AgentPolicyParams): Policy {
  return toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ZeroDev's permission generic is unwieldy across a helper boundary
    permissions: agentPermissionSpec(params) as any,
  });
}

export interface AgentPolicySnapshot {
  callPolicyVersion: `${CallPolicyVersion}`;
  maxSweepPerTx: string;
  executor: Address;
  usdc: Address;
  floatUstb: Address;
  allowedSelectors: string[];
}

/** Human-/DB-readable summary of what a granted session key can do. */
export function agentPolicySnapshot(params: AgentPolicyParams): AgentPolicySnapshot {
  return {
    callPolicyVersion: CallPolicyVersion.V0_0_4,
    maxSweepPerTx: params.maxSweepPerTx.toString(),
    executor: params.deployment.sweepExecutor,
    usdc: params.deployment.usdc,
    floatUstb: params.deployment.floatUstb,
    allowedSelectors: [
      'FloatSweepExecutor.sweepIn(uint256,uint256)',
      'FloatSweepExecutor.sweepOut(uint256,uint256)',
      'USDC.approve(address,uint256)',
      'FloatUSTB.approve(address,uint256)',
    ],
  };
}
