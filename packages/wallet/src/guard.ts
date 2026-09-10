import { decodeFunctionData, toFunctionSelector, type Abi, type AbiFunction, type Hex } from 'viem';
import { ParamCondition } from '@zerodev/permissions/policies';
import { agentPermissionSpec, type AgentPolicyParams } from './policy.js';

/**
 * Off-chain mirror of Layer 1. The ZeroDev `toCallPolicy` validator is the
 * authoritative gate — it rejects an out-of-scope UserOperation cryptographically
 * before it can execute. This module interprets the *same* permission spec object
 * ({@link agentPermissionSpec}) that is handed to `toCallPolicy`, so the agent
 * service can reject a malformed batch locally (saving a guaranteed-to-fail
 * bundler round-trip and surfacing the bug) without maintaining a second copy of
 * the rules. It is defense in depth, never the security boundary.
 */

export interface GuardCall {
  to: Hex;
  data: Hex;
  value?: bigint;
}

export type PolicyViolationCode =
  | 'target-not-allowed'
  | 'selector-not-allowed'
  | 'value-not-allowed'
  | 'decode-failed'
  | 'arg-equal-mismatch'
  | 'arg-above-max'
  | 'arg-below-min'
  | 'arg-condition-unsupported';

export interface PolicyViolation {
  code: PolicyViolationCode;
  message: string;
  /** Index of the offending call within the submitted batch. */
  callIndex: number;
  /** 0-based argument index, when the violation is argument-specific. */
  argIndex?: number;
}

export type PolicyCheckResult = { ok: true } | { ok: false; violation: PolicyViolation };

/** Thrown by {@link assertBatchInPolicy}. */
export class PolicyGuardError extends Error {
  readonly violation: PolicyViolation;
  constructor(violation: PolicyViolation) {
    super(`out-of-policy call [${violation.callIndex}]: ${violation.message}`);
    this.name = 'PolicyGuardError';
    this.violation = violation;
  }
}

type PermissionSpec = ReturnType<typeof agentPermissionSpec>;

interface CompiledEntry {
  target: Hex;
  selector: Hex;
  valueLimit: bigint;
  abi: Abi;
  functionName: string;
  args: readonly (ArgRule | null)[];
}

interface ArgRule {
  condition: ParamCondition;
  value: unknown;
}

const addr = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : String(v));

function isAddressLike(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** Structural equality tolerant of address casing and number/bigint mixing. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (isAddressLike(a) && isAddressLike(b)) return addr(a) === addr(b);
  if ((typeof a === 'bigint' || typeof a === 'number') && (typeof b === 'bigint' || typeof b === 'number')) {
    return BigInt(a) === BigInt(b);
  }
  return a === b;
}

function asBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') return BigInt(v);
  throw new Error(`not numeric: ${String(v)}`);
}

function compile(spec: PermissionSpec): CompiledEntry[] {
  return spec.map((entry): CompiledEntry => {
    const abi = entry.abi as unknown as Abi;
    const fn = abi.find(
      (item): item is AbiFunction => item.type === 'function' && item.name === entry.functionName,
    );
    if (!fn) throw new Error(`spec entry references unknown function ${String(entry.functionName)}`);
    return {
      target: entry.target,
      selector: toFunctionSelector(fn),
      valueLimit: entry.valueLimit ?? 0n,
      abi,
      functionName: entry.functionName,
      args: entry.args ?? [],
    };
  });
}

function checkArg(rule: ArgRule, actual: unknown): PolicyViolationCode | null {
  switch (rule.condition) {
    case ParamCondition.EQUAL:
      return valuesEqual(actual, rule.value) ? null : 'arg-equal-mismatch';
    case ParamCondition.NOT_EQUAL:
      return valuesEqual(actual, rule.value) ? 'arg-equal-mismatch' : null;
    case ParamCondition.LESS_THAN_OR_EQUAL:
      return asBigInt(actual) <= asBigInt(rule.value) ? null : 'arg-above-max';
    case ParamCondition.LESS_THAN:
      return asBigInt(actual) < asBigInt(rule.value) ? null : 'arg-above-max';
    case ParamCondition.GREATER_THAN_OR_EQUAL:
      return asBigInt(actual) >= asBigInt(rule.value) ? null : 'arg-below-min';
    case ParamCondition.GREATER_THAN:
      return asBigInt(actual) > asBigInt(rule.value) ? null : 'arg-below-min';
    default:
      return 'arg-condition-unsupported';
  }
}

/**
 * Check one call against a compiled permission spec. Mirrors the on-chain
 * matching order: target → selector → value limit → per-argument rules.
 */
export function checkCallInPolicy(
  spec: PermissionSpec,
  call: GuardCall,
  callIndex = 0,
): PolicyCheckResult {
  const compiled = compile(spec);
  const selector = call.data.slice(0, 10).toLowerCase();
  const value = call.value ?? 0n;

  const byTarget = compiled.filter((e) => addr(e.target) === addr(call.to));
  if (byTarget.length === 0) {
    return {
      ok: false,
      violation: {
        code: 'target-not-allowed',
        callIndex,
        message: `target ${call.to} is not one of the permitted contracts`,
      },
    };
  }

  const entry = byTarget.find((e) => e.selector.toLowerCase() === selector);
  if (!entry) {
    return {
      ok: false,
      violation: {
        code: 'selector-not-allowed',
        callIndex,
        message: `selector ${selector} on ${call.to} is not permitted`,
      },
    };
  }

  if (value > entry.valueLimit) {
    return {
      ok: false,
      violation: {
        code: 'value-not-allowed',
        callIndex,
        message: `value ${value} exceeds the permitted limit ${entry.valueLimit}`,
      },
    };
  }

  let decoded: readonly unknown[];
  try {
    const res = decodeFunctionData({ abi: entry.abi, data: call.data });
    decoded = res.args ?? [];
  } catch (err) {
    return {
      ok: false,
      violation: {
        code: 'decode-failed',
        callIndex,
        message: `calldata does not decode against ${entry.functionName}: ${(err as Error).message}`,
      },
    };
  }

  for (let i = 0; i < entry.args.length; i++) {
    const rule = entry.args[i];
    if (!rule) continue;
    const bad = checkArg(rule, decoded[i]);
    if (bad) {
      return {
        ok: false,
        violation: {
          code: bad,
          callIndex,
          argIndex: i,
          message: `${entry.functionName} arg[${i}] = ${String(decoded[i])} fails condition ${ParamCondition[rule.condition]} ${String(rule.value)}`,
        },
      };
    }
  }

  return { ok: true };
}

/** Check every call in a batch; returns the first violation or `{ ok: true }`. */
export function checkBatchInPolicy(spec: PermissionSpec, calls: readonly GuardCall[]): PolicyCheckResult {
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!call) continue;
    const res = checkCallInPolicy(spec, call, i);
    if (!res.ok) return res;
  }
  return { ok: true };
}

/** Throw {@link PolicyGuardError} if any call in the batch is out of policy. */
export function assertBatchInPolicy(spec: PermissionSpec, calls: readonly GuardCall[]): void {
  const res = checkBatchInPolicy(spec, calls);
  if (!res.ok) throw new PolicyGuardError(res.violation);
}

export interface AgentGuard {
  spec: PermissionSpec;
  checkCall(call: GuardCall, callIndex?: number): PolicyCheckResult;
  checkBatch(calls: readonly GuardCall[]): PolicyCheckResult;
  assertBatch(calls: readonly GuardCall[]): void;
}

/** Bind the guard to a business's grant parameters (executor + tokens + cap). */
export function agentGuard(params: AgentPolicyParams): AgentGuard {
  const spec = agentPermissionSpec(params);
  return {
    spec,
    checkCall: (call, callIndex) => checkCallInPolicy(spec, call, callIndex),
    checkBatch: (calls) => checkBatchInPolicy(spec, calls),
    assertBatch: (calls) => {
      assertBatchInPolicy(spec, calls);
    },
  };
}
