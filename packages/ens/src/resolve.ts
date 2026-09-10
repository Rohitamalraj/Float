import { namehash } from 'viem/ens';
import { getAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import { permissionedResolverAbi, universalResolverV2Abi } from './abis.js';
import type { EnsDeployment } from './deployment.js';
import { dnsEncodeName } from './naming.js';
import type { ResolverRef } from './resolver.js';

export interface ResolvedName extends ResolverRef {
  ensName: string;
  /** `addr` record — the business's smart account (zero if unset). */
  smartAccount: Address;
}

export class NameNotResolvableError extends Error {
  constructor(ensName: string) {
    super(`"${ensName}" has no resolver on ENS v2`);
    this.name = 'NameNotResolvableError';
  }
}

/**
 * On-chain resolution of a Float name to its resolver, node, and smart account.
 * The gateway uses this when a name is not in the local DB.
 */
export async function resolveFloatName(
  client: PublicClient,
  deployment: EnsDeployment,
  ensName: string,
): Promise<ResolvedName> {
  if (!deployment.universalResolver) {
    throw new Error('UniversalResolverV2 address not configured for this chain');
  }
  const node = namehash(ensName);
  const { resolver } = await client.readContract({
    address: deployment.universalResolver,
    abi: universalResolverV2Abi,
    functionName: 'findResolver',
    args: [dnsEncodeName(ensName)],
  });
  if (resolver === zeroAddress) throw new NameNotResolvableError(ensName);

  const smartAccount = await client.readContract({
    address: getAddress(resolver),
    abi: permissionedResolverAbi,
    functionName: 'addr',
    args: [node],
  });

  return { ensName, resolver: getAddress(resolver), node, smartAccount };
}
