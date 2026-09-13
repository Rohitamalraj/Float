import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import {
  addressToEmptyAccount,
  createKernelAccount,
  createKernelAccountClient,
  type CreateKernelAccountReturnType,
  type KernelAccountClient,
} from '@zerodev/sdk';
import type { Address, Chain, LocalAccount, PublicClient, Transport } from 'viem';
import type { WalletRuntimeConfig } from './config.js';

export interface BusinessAccountParams {
  publicClient: PublicClient;
  /** The business owner signer (holds root control; Float never has this key). */
  ownerAccount: LocalAccount;
  /** Deterministic account index — use 0 unless a business needs multiple wallets. */
  index?: bigint;
  runtime: WalletRuntimeConfig;
}

/**
 * The business's Kernel smart account with only its owner (sudo) validator
 * installed. The account address is deterministic from the owner key + index and
 * is available before deployment; it deploys lazily on the first UserOperation.
 */
export async function getBusinessAccount(
  params: BusinessAccountParams,
): Promise<CreateKernelAccountReturnType> {
  const rt = params.runtime;
  const ecdsaValidator = await signerToEcdsaValidator(params.publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    signer: params.ownerAccount,
  });
  return createKernelAccount(params.publicClient, {
    entryPoint: rt.entryPoint,
    kernelVersion: rt.kernelVersion,
    index: params.index ?? 0n,
    plugins: { sudo: ecdsaValidator },
  });
}

export interface PredictBusinessAccountParams {
  publicClient: PublicClient;
  /** Address of the owner key that will control the account — no signature needed. */
  ownerKeyAddress: Address;
  index?: bigint;
  runtime: WalletRuntimeConfig;
}

/**
 * The deterministic smart account address for an owner key, before that
 * owner has signed anything. Used to auto-provision ENS + the account record
 * as soon as a business names its owner key, ahead of any owner action.
 */
export async function predictBusinessAccountAddress(
  params: PredictBusinessAccountParams,
): Promise<Address> {
  const account = await getBusinessAccount({
    publicClient: params.publicClient,
    ownerAccount: addressToEmptyAccount(params.ownerKeyAddress),
    index: params.index,
    runtime: params.runtime,
  });
  return account.address;
}

export interface BusinessKernelClientParams extends BusinessAccountParams {
  chain: Chain;
  bundlerTransport: Transport;
  paymaster?: Parameters<typeof createKernelAccountClient>[0]['paymaster'];
}

/**
 * An owner-signing Kernel client — used to deploy the account, provision ENS, set
 * policy records, and grant/revoke the agent session key.
 */
export async function businessKernelClient(
  params: BusinessKernelClientParams,
): Promise<KernelAccountClient> {
  const account = await getBusinessAccount(params);
  return createKernelAccountClient({
    account,
    chain: params.chain,
    bundlerTransport: params.bundlerTransport,
    client: params.publicClient,
    paymaster: params.paymaster,
  });
}
