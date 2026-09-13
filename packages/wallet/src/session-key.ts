import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import {
  serializePermissionAccount,
  deserializePermissionAccount,
  toPermissionValidator,
  type Policy,
} from '@zerodev/permissions';
import { toTimestampPolicy } from '@zerodev/permissions/policies';
import { toECDSASigner } from '@zerodev/permissions/signers';
import {
  addressToEmptyAccount,
  createKernelAccount,
  createKernelAccountClient,
  type KernelAccountClient,
} from '@zerodev/sdk';
import {
  http,
  type Account,
  type Address,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import type { FloatDeployment } from '@float/contracts-sdk';
import type { WalletRuntimeConfig } from './config.js';
import { agentPolicySnapshot, buildAgentCallPolicy, type AgentPolicySnapshot } from './policy.js';

/**
 * A Node-side test/service key, or a browser wallet's `WalletClient` (e.g.
 * wagmi's `useWalletClient()`) — ZeroDev's validator construction accepts
 * either directly. Float never holds a business owner's actual key, so the
 * owner-signed flows (grant, revoke) run client-side against a `WalletClient`
 * in the real product; `LocalAccount` exists for scripts and tests.
 */
export type OwnerSigner = LocalAccount | WalletClient<Transport, Chain | undefined, Account>;

export interface GrantSessionKeyParams {
  publicClient: PublicClient;
  /** The business owner signer (root/sudo of the smart account). */
  ownerAccount: OwnerSigner;
  /** Address of the agent's session key (the agent service holds the private key). */
  agentSignerAddress: Address;
  deployment: FloatDeployment;
  maxSweepPerTx: bigint;
  /** Unix seconds after which the key auto-expires. Omit for no expiry. */
  validUntil?: number;
  runtime: WalletRuntimeConfig;
}

export interface GrantedSessionKey {
  /** Owner-signed blob the agent service reconstructs the scoped account from. */
  serializedApproval: string;
  smartAccountAddress: Address;
  agentSignerAddress: Address;
  policySnapshot: AgentPolicySnapshot;
  validUntil?: number;
}

/**
 * Owner-side: mint a scoped agent session key for the business's smart account.
 * The returned `serializedApproval` embeds the owner's signature over the enable
 * data — the agent then only needs its own private key to act.
 */
export async function grantAgentSessionKey(
  params: GrantSessionKeyParams,
): Promise<GrantedSessionKey> {
  const rt = params.runtime;
  const { publicClient, ownerAccount } = params;

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    signer: ownerAccount,
  });

  const emptySessionKeySigner = await toECDSASigner({
    signer: addressToEmptyAccount(params.agentSignerAddress),
  });

  const policies: Policy[] = [
    buildAgentCallPolicy({ deployment: params.deployment, maxSweepPerTx: params.maxSweepPerTx }),
  ];
  if (params.validUntil !== undefined) {
    policies.push(toTimestampPolicy({ validUntil: params.validUntil }));
  }

  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    signer: emptySessionKeySigner,
    policies,
  });

  const sessionKeyAccount = await createKernelAccount(publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    plugins: { sudo: ecdsaValidator, regular: permissionPlugin },
  });

  const serializedApproval = await serializePermissionAccount(sessionKeyAccount);

  return {
    serializedApproval,
    smartAccountAddress: sessionKeyAccount.address,
    agentSignerAddress: params.agentSignerAddress,
    policySnapshot: agentPolicySnapshot({
      deployment: params.deployment,
      maxSweepPerTx: params.maxSweepPerTx,
    }),
    validUntil: params.validUntil,
  };
}

export interface RestoreSessionKeyParams {
  publicClient: PublicClient;
  chain: Chain;
  serializedApproval: string;
  /** The agent's session-key signer (its private key, as a viem account). */
  agentSigner: LocalAccount;
  /** Bundler transport (e.g. `http(ZERODEV_BUNDLER_RPC)`). */
  bundlerTransport: Transport;
  /** Optional paymaster for sponsored gas. */
  paymaster?: Parameters<typeof createKernelAccountClient>[0]['paymaster'];
  runtime: WalletRuntimeConfig;
}

/**
 * Agent-side: reconstruct a ready-to-use Kernel client scoped to the granted
 * permissions. `sendUserOperation` on this client is bounded by Layer 1.
 */
export async function restoreSessionKeyClient(
  params: RestoreSessionKeyParams,
): Promise<KernelAccountClient> {
  const rt = params.runtime;
  const sessionKeySigner = await toECDSASigner({ signer: params.agentSigner });

  const sessionKeyAccount = await deserializePermissionAccount(
    params.publicClient,
    rt.entryPoint,
    rt.kernelVersion,
    params.serializedApproval,
    sessionKeySigner,
  );

  return createKernelAccountClient({
    account: sessionKeyAccount,
    chain: params.chain,
    bundlerTransport: params.bundlerTransport,
    client: params.publicClient,
    paymaster: params.paymaster,
  });
}

export interface RevokeSessionKeyParams {
  publicClient: PublicClient;
  chain: Chain;
  ownerAccount: OwnerSigner;
  agentSignerAddress: Address;
  deployment: FloatDeployment;
  maxSweepPerTx: bigint;
  validUntil?: number;
  bundlerTransport: Transport;
  paymaster?: Parameters<typeof createKernelAccountClient>[0]['paymaster'];
  runtime: WalletRuntimeConfig;
}

/**
 * Owner-side: uninstall the permission validator, immediately and permanently
 * cutting the agent off. Rebuilds the exact plugin so the uninstall targets it.
 */
export async function revokeAgentSessionKey(
  params: RevokeSessionKeyParams,
): Promise<{ userOpHash: `0x${string}` }> {
  const rt = params.runtime;

  const ecdsaValidator = await signerToEcdsaValidator(params.publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    signer: params.ownerAccount,
  });

  const emptySessionKeySigner = await toECDSASigner({
    signer: addressToEmptyAccount(params.agentSignerAddress),
  });
  const policies: Policy[] = [
    buildAgentCallPolicy({ deployment: params.deployment, maxSweepPerTx: params.maxSweepPerTx }),
  ];
  if (params.validUntil !== undefined) {
    policies.push(toTimestampPolicy({ validUntil: params.validUntil }));
  }
  const permissionPlugin = await toPermissionValidator(params.publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    signer: emptySessionKeySigner,
    policies,
  });

  const sudoAccount = await createKernelAccount(params.publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    plugins: { sudo: ecdsaValidator },
  });

  const client = createKernelAccountClient({
    account: sudoAccount,
    chain: params.chain,
    bundlerTransport: params.bundlerTransport,
    client: params.publicClient,
    paymaster: params.paymaster,
  });

  const userOpHash = await client.uninstallPlugin({ plugin: permissionPlugin });
  return { userOpHash };
}

/** Convenience: an http bundler transport from the runtime config. */
export function bundlerTransportFromRuntime(rt: WalletRuntimeConfig): Transport {
  if (!rt.bundlerRpc) throw new Error('ZERODEV_BUNDLER_RPC is not set');
  return http(rt.bundlerRpc);
}
