import { getAddress, type Address } from 'viem';
import { activeChainKey, getChainConfig, type ChainKey } from '@float/config';

/** Resolved ENS v2 deployment addresses for a chain. */
export interface EnsDeployment {
  chainKey: ChainKey;
  chainId: number;
  registry: Address;
  registrar: Address;
  paymentToken: Address;
  resolverFactory: Address;
  resolverImplementation: Address;
  resolverProxyLogic: Address;
  subregistryImplementation: Address;
}

export class EnsNotDeployedError extends Error {
  constructor(chainKey: ChainKey) {
    super(`ENS v2 is not deployed on chain "${chainKey}" (beta is Sepolia-only)`);
    this.name = 'EnsNotDeployedError';
  }
}

export function resolveEnsDeployment(chainKey: ChainKey = activeChainKey()): EnsDeployment {
  const chain = getChainConfig(chainKey);
  const e = chain.ens;
  if (
    !e.registry ||
    !e.registrar ||
    !e.paymentToken ||
    !e.resolverFactory ||
    !e.resolverImplementation ||
    !e.resolverProxyLogic ||
    !e.subregistryImplementation
  ) {
    throw new EnsNotDeployedError(chainKey);
  }
  return {
    chainKey,
    chainId: chain.chainId,
    registry: getAddress(e.registry),
    registrar: getAddress(e.registrar),
    paymentToken: getAddress(e.paymentToken),
    resolverFactory: getAddress(e.resolverFactory),
    resolverImplementation: getAddress(e.resolverImplementation),
    resolverProxyLogic: getAddress(e.resolverProxyLogic),
    subregistryImplementation: getAddress(e.subregistryImplementation),
  };
}
