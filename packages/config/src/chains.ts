import type { Address } from 'viem';

export type ChainKey = 'mainnet' | 'sepolia' | 'anvil';

/**
 * Uniswap v4 Permissioned Pools deployment.
 * Source: developers.uniswap.org — v4-periphery pinned commit
 * 3245c3cb99c48fa1dc2459c3b60abc37d4294aba.
 */
export interface UniswapPermissionedAddresses {
  permissionsAdapterFactory: Address;
  permissionedPositionManager: Address;
  permissionedHooks: Address;
  /** Permissioned Universal Router (2.2.0+) — all permissioned swaps route here. */
  universalRouter: Address;
  v4Quoter: Address;
  mixedRouteQuoterV2: Address;
  permit2: Address;
  /** Canonical v4 PoolManager — TODO verify per chain; not needed for the routed swap path. */
  poolManager?: Address;
}

/**
 * ENS v2 (beta) deployment.
 *
 * ⚠ The Sepolia addresses below are provisional (captured from docs, not yet
 * verified against live contracts). `packages/ens` MUST verify these on first
 * connect — see `docs/mocked-vs-real.md`. Override via env when confirmed.
 */
export interface EnsV2Addresses {
  ethRegistry?: Address;
  ethRegistrar?: Address;
  batchRegistrar?: Address;
  publicResolverV2?: Address;
  permissionedResolverImpl?: Address;
  standaloneHcaFactory?: Address;
  universalResolver?: Address;
}

export interface ChainConfig {
  key: ChainKey;
  chainId: number;
  name: string;
  /** ERC-4337 EntryPoint v0.7 (canonical). */
  entryPoint: Address;
  /** Stablecoin leg of every sweep. */
  usdc: Address;
  uniswap: UniswapPermissionedAddresses;
  ens: EnsV2Addresses;
}

const ENTRYPOINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const MAINNET: ChainConfig = {
  key: 'mainnet',
  chainId: 1,
  name: 'Ethereum',
  entryPoint: ENTRYPOINT_V07,
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  uniswap: {
    permissionsAdapterFactory: '0x7DA911490Ca4663E572eA9C8154f3CdEbCE16452',
    permissionedPositionManager: '0x63Bd7e5D4EcfAA74d82AE1dE98F476C935a81973',
    permissionedHooks: '0x499a724Ab630549f14C995EC41a8E04fA3fd28c0',
    universalRouter: '0x0542093271A31f6FC1DADB232bd59eeb27de780F',
    v4Quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
    mixedRouteQuoterV2: '0xE63C5F5005909E96b5aA9CE10744CCE70eC16CC3',
    permit2: PERMIT2,
  },
  ens: {
    // ENS v2 is not on mainnet yet.
  },
};

const SEPOLIA: ChainConfig = {
  key: 'sepolia',
  chainId: 11155111,
  name: 'Sepolia',
  entryPoint: ENTRYPOINT_V07,
  // Circle test USDC on Sepolia.
  usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  uniswap: {
    permissionsAdapterFactory: '0xE6B0d96919334C33d06266d1420F97f6f434fA2B',
    permissionedPositionManager: '0xf99D553912084c99F6299291b75Fe9B7119Aa1A7',
    permissionedHooks: '0x51247E2291d290d17C08813A175AC86465EdE8c0',
    universalRouter: '0x54C707Df83f03bc9cA64ED2CcF9C99B63FD854b7',
    v4Quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    mixedRouteQuoterV2: '0x4745F77b56a0E2294426E3936dc4Fab68d9543Cd',
    permit2: PERMIT2,
  },
  ens: {
    // ⚠ UNVERIFIED — confirm against https://docs.ens.domains/learn/deployments
    ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2',
    ethRegistrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc',
    batchRegistrar: '0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb',
    publicResolverV2: '0xe7b9a25607e02da8145e4eb1836ca539e53f11f7',
    permissionedResolverImpl: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e',
    standaloneHcaFactory: '0x900ff7cf617ef9d802178b4ef480491e3a782672',
  },
};

/** Anvil fork of Sepolia — same contract addresses, local chain id. */
const ANVIL: ChainConfig = {
  ...SEPOLIA,
  key: 'anvil',
  chainId: 31337,
  name: 'Anvil (Sepolia fork)',
};

export const CHAINS: Record<ChainKey, ChainConfig> = {
  mainnet: MAINNET,
  sepolia: SEPOLIA,
  anvil: ANVIL,
};

export function getChainConfig(key: ChainKey): ChainConfig {
  return CHAINS[key];
}

export function getChainConfigById(chainId: number): ChainConfig {
  const found = Object.values(CHAINS).find((c) => c.chainId === chainId);
  if (!found) throw new Error(`No Float chain config for chainId ${chainId}`);
  return found;
}
