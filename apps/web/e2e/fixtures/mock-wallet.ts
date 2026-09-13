import type { BrowserContext } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** Well-known Anvil/Hardhat default test key #0 — never used on a real chain. */
export const TEST_PRIVATE_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

/**
 * Installs a minimal EIP-1193 + EIP-6963 injected provider backed by a local
 * viem account, so wagmi's `injected()` connector can drive a real SIWE
 * sign-in with no browser extension. Signing happens in the Playwright (Node)
 * process via `exposeFunction` — the private key never enters page context.
 */
export async function installMockWallet(
  context: BrowserContext,
  chainId = 11155111,
): Promise<void> {
  await context.exposeFunction('__floatSign', async (message: string) => {
    const isHex = /^0x[0-9a-fA-F]*$/.test(message);
    return testAccount.signMessage({ message: isHex ? { raw: message as Hex } : message });
  });

  await context.addInitScript(
    ({ address, chainIdHex }: { address: string; chainIdHex: string }) => {
      type Handler = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Handler>>();

      const provider = {
        isMetaMask: true,
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }): Promise<unknown> => {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [address];
            case 'eth_chainId':
              return chainIdHex;
            case 'net_version':
              return String(parseInt(chainIdHex, 16));
            case 'personal_sign': {
              const [message] = (params ?? []) as [string, string];
              return (
                window as unknown as { __floatSign: (m: string) => Promise<string> }
              ).__floatSign(message);
            }
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              return null;
            default:
              throw new Error(`mock wallet: unsupported method ${method}`);
          }
        },
        on: (event: string, cb: Handler) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)?.add(cb);
        },
        removeListener: (event: string, cb: Handler) => {
          listeners.get(event)?.delete(cb);
        },
      };

      Object.defineProperty(window, 'ethereum', {
        value: provider,
        writable: true,
        configurable: true,
      });

      const announce = (): void => {
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({
              info: {
                uuid: 'float-mock-wallet',
                name: 'Float Test Wallet',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                rdns: 'com.float.mock',
              },
              provider,
            }),
          }),
        );
      };
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    },
    { address: testAccount.address, chainIdHex: `0x${chainId.toString(16)}` },
  );
}
