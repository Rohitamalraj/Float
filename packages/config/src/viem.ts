import { createPublicClient, http, type Chain, type PublicClient, type Transport } from 'viem';
import { foundry, mainnet, sepolia } from 'viem/chains';
import type { ChainKey } from './chains.js';
import { getChainConfig } from './chains.js';
import { loadEnv, rpcUrlFor, type FloatEnv } from './env.js';

export function viemChainFor(key: ChainKey): Chain {
  switch (key) {
    case 'mainnet':
      return mainnet;
    case 'sepolia':
      return sepolia;
    case 'anvil':
      return { ...foundry, id: getChainConfig('anvil').chainId };
  }
}

export function transportFor(key: ChainKey, env: FloatEnv = loadEnv()): Transport {
  return http(rpcUrlFor(key, env), { batch: true });
}

export function publicClientFor(
  key: ChainKey = loadEnv().FLOAT_CHAIN,
  env: FloatEnv = loadEnv(),
): PublicClient {
  return createPublicClient({
    chain: viemChainFor(key),
    transport: transportFor(key, env),
  });
}
