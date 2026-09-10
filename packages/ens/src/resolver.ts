import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import {
  ALL_COMPLIANCE_KEYS,
  ALL_FLOAT_RECORD_KEYS,
  ALL_POLICY_KEYS,
  type ComplianceKey,
  type FloatRecordKey,
  type PolicyKey,
} from '@float/config';
import {
  parseComplianceRecords,
  parsePolicyRecords,
  serializeComplianceRecords,
  serializePolicyRecords,
  type ComplianceState,
  type SweepPolicy,
} from '@float/core';
import type { Call } from '@float/contracts-sdk';
import { permissionedResolverAbi } from './abis.js';
import { dnsEncodeName } from './naming.js';

export interface ResolverRef {
  /** The name's PermissionedResolver proxy. */
  resolver: Address;
  /** namehash of the name. */
  node: Hex;
}

// ── reads ──────────────────────────────────────────────────────────────────

export type FloatRecords = Partial<Record<FloatRecordKey, string>>;

/** Read every `float.*` text record off the name's resolver in one multicall. */
export async function readFloatRecords(
  client: PublicClient,
  ref: ResolverRef,
): Promise<FloatRecords> {
  const results = await client.multicall({
    allowFailure: true,
    contracts: ALL_FLOAT_RECORD_KEYS.map((key) => ({
      address: ref.resolver,
      abi: permissionedResolverAbi,
      functionName: 'text' as const,
      args: [ref.node, key] as const,
    })),
  });

  const out: FloatRecords = {};
  ALL_FLOAT_RECORD_KEYS.forEach((key, i) => {
    const r = results[i];
    if (r?.status === 'success' && typeof r.result === 'string' && r.result !== '') {
      out[key] = r.result;
    }
  });
  return out;
}

export interface ParsedFloatState {
  /** null when the owner has not set a complete policy yet. */
  policy: SweepPolicy | null;
  compliance: ComplianceState;
  raw: FloatRecords;
}

export async function readParsedFloatState(
  client: PublicClient,
  ref: ResolverRef,
): Promise<ParsedFloatState> {
  const raw = await readFloatRecords(client, ref);
  let policy: SweepPolicy | null = null;
  try {
    policy = parsePolicyRecords(raw);
  } catch {
    policy = null;
  }
  return { policy, compliance: parseComplianceRecords(raw), raw };
}

export async function readSmartAccount(client: PublicClient, ref: ResolverRef): Promise<Address> {
  return client.readContract({
    address: ref.resolver,
    abi: permissionedResolverAbi,
    functionName: 'addr',
    args: [ref.node],
  });
}

// ── writes (calldata only — the caller signs with the right key) ────────────

function setTextData(node: Hex, key: string, value: string): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: 'setText',
    args: [node, key, value],
  });
}

function multicall(resolver: Address, inner: Hex[]): Call {
  if (inner.length === 1) return { to: resolver, value: 0n, data: inner[0]! };
  return {
    to: resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: 'multicall',
      args: [inner],
    }),
  };
}

/** Set an arbitrary set of text records in one call. */
export function encodeSetTextRecords(ref: ResolverRef, records: Record<string, string>): Call {
  const inner = Object.entries(records).map(([k, v]) => setTextData(ref.node, k, v));
  if (inner.length === 0) throw new Error('encodeSetTextRecords: no records');
  return multicall(ref.resolver, inner);
}

/** Owner-signed: write the Layer 2 policy records. */
export function encodeSetPolicyRecords(ref: ResolverRef, policy: SweepPolicy): Call {
  return encodeSetTextRecords(ref, serializePolicyRecords(policy));
}

/** Oracle-signed: write the compliance attestation records. */
export function encodeSetComplianceRecords(ref: ResolverRef, state: ComplianceState): Call {
  return encodeSetTextRecords(ref, serializeComplianceRecords(state));
}

export function encodeSetSmartAccount(ref: ResolverRef, account: Address): Call {
  return {
    to: ref.resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: 'setAddr',
      args: [ref.node, account],
    }),
  };
}

export interface RecordRoleSplit {
  ensName: string;
  /** Business owner key — gets write access to the policy keys. */
  ownerKey: Address;
  /** Float compliance-oracle key — gets write access to the compliance keys. */
  oracleKey: Address;
}

/**
 * Provisioner-signed: delegate per-key `ROLE_SET_TEXT` on the name's resolver so
 * the owner can only write policy records and the oracle can only write
 * compliance records. Idempotent-ish (re-granting is a no-op on chain).
 */
export function encodeAuthorizeRecordRoleSplit(ref: ResolverRef, split: RecordRoleSplit): Call {
  const dns = dnsEncodeName(split.ensName);
  const auth = (key: string, account: Address) =>
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: 'authorizeTextRoles',
      args: [dns, key, account, true],
    });

  const inner: Hex[] = [
    ...ALL_POLICY_KEYS.map((k: PolicyKey) => auth(k, split.ownerKey)),
    ...ALL_COMPLIANCE_KEYS.map((k: ComplianceKey) => auth(k, split.oracleKey)),
  ];
  return multicall(ref.resolver, inner);
}

/** Provisioner-signed: revoke a previously granted per-key text role. */
export function encodeRevokeTextRole(
  ref: ResolverRef,
  ensName: string,
  key: string,
  account: Address,
): Call {
  return {
    to: ref.resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: 'authorizeTextRoles',
      args: [dnsEncodeName(ensName), key, account, false],
    }),
  };
}
