import { getAddress, type Address, type Hex } from 'viem';
import {
  activeChainKey,
  getChainConfig,
  loadEnv,
  MissingConfigError,
  type ChainKey,
  type FloatEnv,
} from '@float/config';

/** Every address the Float SDK needs, for one chain. */
export interface FloatDeployment {
  chainKey: ChainKey;
  chainId: number;
  usdc: Address;
  complianceRegistry: Address;
  allowlistChecker: Address;
  policyView: Address;
  sweepExecutor: Address;
  floatUstb: Address;
  yieldReserve: Address;
  /** Uniswap PermissionsAdapter that wraps FloatUSTB in the pool. */
  permissionsAdapter: Address;
  /** v4 pool id of the FloatUSTB/USDC permissioned pool. */
  poolId?: Hex;
}

type EnvKey = keyof FloatEnv;

const ENV_KEYS: Record<
  Exclude<keyof FloatDeployment, 'chainKey' | 'chainId' | 'poolId'>,
  EnvKey
> = {
  usdc: 'USDC_ADDRESS',
  complianceRegistry: 'FLOAT_COMPLIANCE_REGISTRY_ADDRESS',
  allowlistChecker: 'FLOAT_ALLOWLIST_CHECKER_ADDRESS',
  policyView: 'FLOAT_POLICY_VIEW_ADDRESS',
  sweepExecutor: 'FLOAT_SWEEP_EXECUTOR_ADDRESS',
  floatUstb: 'FLOAT_USTB_ADDRESS',
  yieldReserve: 'FLOAT_YIELD_RESERVE_ADDRESS',
  permissionsAdapter: 'FLOAT_PERMISSIONS_ADAPTER_ADDRESS',
};

export interface ResolveOptions {
  chainKey?: ChainKey;
  env?: FloatEnv;
}

/**
 * Build a {@link FloatDeployment} from environment variables (see `.env.example`).
 * `usdc` falls back to the per-chain default in `@float/config`. Throws
 * {@link MissingConfigError} for any Float contract address that is unset —
 * use {@link tryResolveFloatDeployment} when the contracts may not be deployed yet.
 */
export function resolveFloatDeployment(opts: ResolveOptions = {}): FloatDeployment {
  const env = opts.env ?? loadEnv();
  const chainKey = opts.chainKey ?? activeChainKey();
  const chain = getChainConfig(chainKey);

  const pick = (field: keyof typeof ENV_KEYS): Address => {
    const envKey = ENV_KEYS[field];
    const raw = env[envKey] as string | undefined;
    if (!raw) {
      if (field === 'usdc') return getAddress(chain.usdc);
      throw new MissingConfigError(envKey, `resolve the Float ${field} address`);
    }
    return getAddress(raw);
  };

  const poolIdRaw = env.FLOAT_POOL_ID;
  return {
    chainKey,
    chainId: chain.chainId,
    usdc: pick('usdc'),
    complianceRegistry: pick('complianceRegistry'),
    allowlistChecker: pick('allowlistChecker'),
    policyView: pick('policyView'),
    sweepExecutor: pick('sweepExecutor'),
    floatUstb: pick('floatUstb'),
    yieldReserve: pick('yieldReserve'),
    permissionsAdapter: pick('permissionsAdapter'),
    poolId: poolIdRaw ? (poolIdRaw as Hex) : undefined,
  };
}

/** Like {@link resolveFloatDeployment} but returns `undefined` if anything is missing. */
export function tryResolveFloatDeployment(opts: ResolveOptions = {}): FloatDeployment | undefined {
  try {
    return resolveFloatDeployment(opts);
  } catch (err) {
    if (err instanceof MissingConfigError) return undefined;
    throw err;
  }
}
