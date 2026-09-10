import { getEntryPoint, KERNEL_V3_1, KERNEL_V3_2, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import type { EntryPointVersion } from 'viem/account-abstraction';
import { loadEnv, type FloatEnv } from '@float/config';

// KERNEL_V3_1 / _2 / _3 all share the `KERNEL_V3_VERSION_TYPE` nominal type.
export type KernelVersion = typeof KERNEL_V3_3;

const KERNEL_VERSIONS: Record<'0.3.1' | '0.3.2' | '0.3.3', KernelVersion> = {
  '0.3.1': KERNEL_V3_1,
  '0.3.2': KERNEL_V3_2,
  '0.3.3': KERNEL_V3_3,
};

export interface WalletRuntimeConfig {
  entryPointVersion: EntryPointVersion;
  entryPoint: ReturnType<typeof getEntryPoint<'0.7'>>;
  kernelVersion: KernelVersion;
  /** ZeroDev (or Pimlico) bundler RPC — required to submit UserOperations. */
  bundlerRpc?: string;
  /** ZeroDev paymaster RPC — optional (sponsored gas). */
  paymasterRpc?: string;
}

/**
 * ERC-4337 / Kernel runtime settings. EntryPoint is fixed at v0.7 (Float's whole
 * Layer 1 model is written against it); the Kernel version defaults to v3.3 and
 * can be pinned with `KERNEL_VERSION` (0.3.1 / 0.3.2 / 0.3.3).
 */
export function walletRuntimeConfig(env: FloatEnv = loadEnv()): WalletRuntimeConfig {
  const kernelVersion = KERNEL_VERSIONS[env.KERNEL_VERSION] ?? KERNEL_V3_3;
  return {
    entryPointVersion: '0.7',
    entryPoint: getEntryPoint('0.7'),
    kernelVersion,
    bundlerRpc: env.ZERODEV_BUNDLER_RPC,
    paymasterRpc: env.ZERODEV_PAYMASTER_RPC,
  };
}
