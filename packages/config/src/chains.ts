import type { Address } from 'viem';

export type ChainKey = 'mainnet' | 'sepolia' | 'anvil';

/**
 * Uniswap v4 Permissioned Pools deployment.
 * Contracts match v4-periphery `main` @ dce236d4e2057422d0791d9a973a58765eb46f65
 * (the commit the live Sepolia deployment was built from — verified via a
 * fork round-trip in `contracts/test/fork/`).
 */
export interface UniswapPermissionedAddresses {
  permissionsAdapterFactory: Address;
  permissionedPositionManager: Address;
  permissionedHooks: Address;
  /** Permissioned Universal Router — all permissioned swaps route here. */
  universalRouter: Address;
  v4Quoter: Address;
  mixedRouteQuoterV2: Address;
  permit2: Address;
  /** Canonical v4 PoolManager (from `factory.POOL_MANAGER()`). */
  poolManager?: Address;
}

/**
 * ENS v2 (beta) deployment — canonical contracts-v2 deployment of 2026-07-30
 * (PR #388), verified on Sepolia via `cast codesize`. Addresses come from the
 * ENS team's own `ensdomains/ens-cli`.
 */
export interface EnsV2Addresses {
  /** Root / `.eth` PermissionedRegistry. */
  registry?: Address;
  /** `.eth` registrar (2LD registration). */
  registrar?: Address;
  /** ERC-20 the registrar charges for 2LD registration. */
  paymentToken?: Address;
  /** VerifiableFactory that deploys resolver + subregistry proxies via CREATE2. */
  resolverFactory?: Address;
  /** PermissionedResolver implementation behind the per-owner proxies. */
  resolverImplementation?: Address;
  /** EIP-1167 proxy logic used for CREATE2 address prediction. */
  resolverProxyLogic?: Address;
  /** UserRegistry implementation (deployed per parent name to hold subnames). */
  subregistryImplementation?: Address;
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
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  },
  ens: {
    registry: '0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2',
    registrar: '0xa88553F454b77203B0D036A05c894d555EAAa2Cc',
    paymentToken: '0x768F42455A2D082E23ceeF7d51e5787C82d67a39',
    resolverFactory: '0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef',
    resolverImplementation: '0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e',
    resolverProxyLogic: '0xA136BeE4E37B44586242e516a39893EfD54315e9',
    subregistryImplementation: '0x624a25d67B59D587752EbEc8DdeD8827dAe52050',
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
