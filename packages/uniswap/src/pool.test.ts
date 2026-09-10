import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { applySlippage } from './quote.js';
import { buildFloatPoolKey, resolveFloatVenue, usdcIsCurrency0, zeroForOneFor } from './pool.js';

// USDC (0x1c7d…) sorts BELOW this adapter, and ABOVE a low one.
const HIGH_ADAPTER = getAddress('0xffffffffffffffffffffffffffffffffffffffff');
const LOW_ADAPTER = getAddress('0x0000000000000000000000000000000000000001');
const USDC = getAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238');

describe('buildFloatPoolKey', () => {
  it('sorts currencies numerically and carries the venue params', () => {
    const venue = resolveFloatVenue({ chainKey: 'sepolia' });
    const key = buildFloatPoolKey({ usdc: USDC, permissionsAdapter: HIGH_ADAPTER }, venue);
    expect(key.currency0).toBe(USDC);
    expect(key.currency1).toBe(HIGH_ADAPTER);
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
    expect(key.hooks).toBe(getAddress('0x51247E2291d290d17C08813A175AC86465EdE8c0'));

    const flipped = buildFloatPoolKey({ usdc: USDC, permissionsAdapter: LOW_ADAPTER }, venue);
    expect(flipped.currency0).toBe(LOW_ADAPTER);
    expect(flipped.currency1).toBe(USDC);
  });
});

describe('zeroForOneFor', () => {
  it('sweep-in spends USDC; direction of the swap depends on currency ordering', () => {
    const usdcC0 = { usdc: USDC, permissionsAdapter: HIGH_ADAPTER }; // USDC is currency0
    expect(usdcIsCurrency0(usdcC0)).toBe(true);
    expect(zeroForOneFor('in', usdcC0)).toBe(true);
    expect(zeroForOneFor('out', usdcC0)).toBe(false);

    const usdcC1 = { usdc: USDC, permissionsAdapter: LOW_ADAPTER }; // USDC is currency1
    expect(zeroForOneFor('in', usdcC1)).toBe(false);
    expect(zeroForOneFor('out', usdcC1)).toBe(true);
  });
});

describe('applySlippage', () => {
  it('reduces by the given bps, rounding down', () => {
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n); // -0.5%
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n);
    expect(applySlippage(3n, 50)).toBe(2n);
  });
  it('rejects out-of-range bps', () => {
    expect(() => applySlippage(1n, -1)).toThrow();
    expect(() => applySlippage(1n, 10_000)).toThrow();
  });
});

describe('resolveFloatVenue', () => {
  it('reads the Sepolia Uniswap addresses from @float/config', () => {
    const v = resolveFloatVenue({ chainKey: 'sepolia' });
    expect(v.v4Quoter).toBe(getAddress('0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227'));
    expect(v.universalRouter).toBe(getAddress('0x54C707Df83f03bc9cA64ED2CcF9C99B63FD854b7'));
  });
});
