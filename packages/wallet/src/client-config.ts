import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import type { WalletRuntimeConfig } from './config.js';

/**
 * Browser-safe runtime config: deliberately does NOT import from `./config.js`
 * at the value level — that file pulls in `@float/config`'s `loadEnv()`
 * (`node:fs`/`node:path`), which a client bundle must never see. Only the
 * `WalletRuntimeConfig` *type* is shared (erased at compile time).
 *
 * Fixed at EntryPoint 0.7 / Kernel v3.3, the constants this whole product is
 * pinned to — for owner-signed flows that run client-side and never touch a
 * bundler (granting or revoking a session key). `restoreSessionKeyClient`
 * (agent-side, needs a bundler) still requires the full server-side config.
 */
export function clientWalletRuntimeConfig(): WalletRuntimeConfig {
  return {
    entryPointVersion: '0.7',
    entryPoint: getEntryPoint('0.7'),
    kernelVersion: KERNEL_V3_3,
  };
}
