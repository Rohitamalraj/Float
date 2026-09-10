import { getAddress, type Address } from 'viem';
import { activeChainKey, getChainConfig, type ChainKey } from '@float/config';
import type { FloatDeployment } from '@float/contracts-sdk';
import type { PoolKey } from './abis.js';

export const DEFAULT_POOL_FEE = 3000;
export const DEFAULT_TICK_SPACING = 60;

export interface FloatVenue {
  v4Quoter: Address;
  universalRouter: Address;
  permissionedHooks: Address;
  fee: number;
  tickSpacing: number;
}

/** Uniswap-side addresses + pool params for the FloatUSTB/USDC permissioned pool. */
export function resolveFloatVenue(
  opts: { chainKey?: ChainKey; fee?: number; tickSpacing?: number } = {},
): FloatVenue {
  const chain = getChainConfig(opts.chainKey ?? activeChainKey());
  return {
    v4Quoter: getAddress(chain.uniswap.v4Quoter),
    universalRouter: getAddress(chain.uniswap.universalRouter),
    permissionedHooks: getAddress(chain.uniswap.permissionedHooks),
    fee: opts.fee ?? DEFAULT_POOL_FEE,
    tickSpacing: opts.tickSpacing ?? DEFAULT_TICK_SPACING,
  };
}

/**
 * The pool trades USDC against the PermissionsAdapter currency (which wraps
 * FloatUSTB). Currencies are sorted numerically per v4.
 */
export function buildFloatPoolKey(
  deployment: Pick<FloatDeployment, 'usdc' | 'permissionsAdapter'>,
  venue: Pick<FloatVenue, 'fee' | 'tickSpacing' | 'permissionedHooks'>,
): PoolKey {
  const usdc = getAddress(deployment.usdc);
  const adapter = getAddress(deployment.permissionsAdapter);
  const usdcIsCurrency0 = BigInt(usdc) < BigInt(adapter);
  return {
    currency0: usdcIsCurrency0 ? usdc : adapter,
    currency1: usdcIsCurrency0 ? adapter : usdc,
    fee: venue.fee,
    tickSpacing: venue.tickSpacing,
    hooks: getAddress(venue.permissionedHooks),
  };
}

export function usdcIsCurrency0(
  deployment: Pick<FloatDeployment, 'usdc' | 'permissionsAdapter'>,
): boolean {
  return BigInt(getAddress(deployment.usdc)) < BigInt(getAddress(deployment.permissionsAdapter));
}

export type SweepDirection = 'in' | 'out';

/** `in` = USDC→FloatUSTB (park); `out` = FloatUSTB→USDC (redeem). */
export function zeroForOneFor(
  direction: SweepDirection,
  deployment: Pick<FloatDeployment, 'usdc' | 'permissionsAdapter'>,
): boolean {
  const usdcC0 = usdcIsCurrency0(deployment);
  // sweep-in spends USDC -> zeroForOne when USDC is currency0
  return direction === 'in' ? usdcC0 : !usdcC0;
}
