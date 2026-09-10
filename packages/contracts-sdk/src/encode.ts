import { encodeFunctionData, type Address, type Hex } from 'viem';
import {
  erc20Abi,
  floatComplianceRegistryAbi,
  floatPolicyViewAbi,
  floatSweepExecutorAbi,
} from './abis/index.js';

/** A single call, ready to drop into a UserOperation batch or a wallet tx. */
export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
}

export function encodeApprove(token: Address, spender: Address, amount: bigint): Call {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
  };
}

/**
 * The two-call batch the agent session key submits for a sweep-in: an exact
 * USDC approval to the executor, then the bounded swap. Matches the Layer 1
 * call policy (USDC.approve to executor + executor.sweepIn, both `value == 0`,
 * both first arg `<= maxSweepPerTx`).
 */
export function encodeSweepIn(params: {
  executor: Address;
  usdc: Address;
  usdcIn: bigint;
  minTokenOut: bigint;
}): [Call, Call] {
  return [
    encodeApprove(params.usdc, params.executor, params.usdcIn),
    {
      to: params.executor,
      value: 0n,
      data: encodeFunctionData({
        abi: floatSweepExecutorAbi,
        functionName: 'sweepIn',
        args: [params.usdcIn, params.minTokenOut],
      }),
    },
  ];
}

/** Sweep-out batch: approve FloatUSTB to the executor, then redeem to USDC. */
export function encodeSweepOut(params: {
  executor: Address;
  floatUstb: Address;
  tokenIn: bigint;
  minUsdcOut: bigint;
}): [Call, Call] {
  return [
    encodeApprove(params.floatUstb, params.executor, params.tokenIn),
    {
      to: params.executor,
      value: 0n,
      data: encodeFunctionData({
        abi: floatSweepExecutorAbi,
        functionName: 'sweepOut',
        args: [params.tokenIn, params.minUsdcOut],
      }),
    },
  ];
}

// ── Oracle / policy-sync writes (submitted by Float's operational keys) ──────

export type OnchainKycStatusEnum = 0 | 1 | 2 | 3 | 4; // None|Verified|Pending|Revoked|Expired

export function encodeSetAttestation(params: {
  registry: Address;
  account: Address;
  status: OnchainKycStatusEnum;
  accredited: boolean;
  expiresAt: bigint;
  allowlistId: Hex;
}): Call {
  return {
    to: params.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: floatComplianceRegistryAbi,
      functionName: 'setAttestation',
      args: [
        params.account,
        params.status,
        params.accredited,
        params.expiresAt,
        params.allowlistId,
      ],
    }),
  };
}

export function encodeRevokeAttestation(registry: Address, account: Address): Call {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: floatComplianceRegistryAbi,
      functionName: 'revoke',
      args: [account],
    }),
  };
}

export function encodeSetPolicy(params: {
  policyView: Address;
  account: Address;
  bufferAmount: bigint;
  maxSweepPerTx: bigint;
}): Call {
  return {
    to: params.policyView,
    value: 0n,
    data: encodeFunctionData({
      abi: floatPolicyViewAbi,
      functionName: 'setPolicy',
      args: [params.account, params.bufferAmount, params.maxSweepPerTx],
    }),
  };
}

export function encodeClearPolicy(policyView: Address, account: Address): Call {
  return {
    to: policyView,
    value: 0n,
    data: encodeFunctionData({
      abi: floatPolicyViewAbi,
      functionName: 'clearPolicy',
      args: [account],
    }),
  };
}
