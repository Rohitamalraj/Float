import { createPublicClient, http, type PublicClient } from 'viem';
import { activeChainKey, loadEnv, rpcUrlFor, viemChainFor } from '@float/config';
import { resolveFloatDeployment, tryResolveFloatDeployment } from '@float/contracts-sdk';
import { EnsNotDeployedError, resolveEnsDeployment } from '@float/ens';

export const env = loadEnv();
export const chainKey = activeChainKey();
export const chain = viemChainFor(chainKey);

let _client: PublicClient | undefined;
export function publicClient(): PublicClient {
  _client ??= createPublicClient({ chain, transport: http(rpcUrlFor(chainKey, env)) });
  return _client;
}

/** May be undefined before the Float contracts are deployed. */
export const floatDeployment = tryResolveFloatDeployment({ chainKey, env });

export function requireDeployment() {
  return resolveFloatDeployment({ chainKey, env });
}

export const ensDeployment = (() => {
  try {
    return resolveEnsDeployment(chainKey);
  } catch (err) {
    if (err instanceof EnsNotDeployedError) return undefined;
    throw err;
  }
})();
