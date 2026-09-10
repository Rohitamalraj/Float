import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import {
  createKernelAccount,
  createKernelAccountClient,
  type CreateKernelAccountReturnType,
  type KernelAccountClient,
} from '@zerodev/sdk';
import type { Chain, LocalAccount, PublicClient, Transport } from 'viem';
import { walletRuntimeConfig, type WalletRuntimeConfig } from './config.js';

export interface BusinessAccountParams {
  publicClient: PublicClient;
  /** The business owner signer (holds root control; Float never has this key). */
  ownerAccount: LocalAccount;
  /** Deterministic account index — use 0 unless a business needs multiple wallets. */
  index?: bigint;
  runtime?: WalletRuntimeConfig;
}

/**
 * The business's Kernel smart account with only its owner (sudo) validator
 * installed. The account address is deterministic from the owner key + index and
 * is available before deployment; it deploys lazily on the first UserOperation.
 */
export async function getBusinessAccount(
  params: BusinessAccountParams,
): Promise<CreateKernelAccountReturnType> {
  const rt = params.runtime ?? walletRuntimeConfig();
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
