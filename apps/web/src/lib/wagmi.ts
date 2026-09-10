'use client';

import { http, createConfig, createStorage, cookieStorage } from 'wagmi';
import { mainnet, sepolia, foundry } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const chainKey = process.env.NEXT_PUBLIC_CHAIN ?? 'sepolia';

/** The chain Float is configured for — used for the SIWE `chainId`. */
export const activeChain =
  chainKey === 'mainnet' ? mainnet : chainKey === 'anvil' ? foundry : sepolia;

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, foundry],
  connectors: [injected()],
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [foundry.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
