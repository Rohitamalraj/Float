import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { evaluateSweep } from './evaluate.js';
import type { ComplianceState, SweepContext, SweepPolicy } from './types.js';

const usdc = (n: string) => parseUnits(n, 6);

const POLICY: SweepPolicy = {
  bufferAmount: usdc('2000'),
  maxSweepPerTx: usdc('10000'),
  allowedProtocol: '0x00000000000000000000000000000000000000A1',
  targetYieldToken: '0x00000000000000000000000000000000000000B2',
};

const VERIFIED: ComplianceState = {
  kycStatus: 'verified',
  accreditation: 'accredited',
  kycVerifiedAt: new Date('2026-09-01T00:00:00Z'),
  allowlistId: 'float-ustb-1',
};

const NOW = new Date('2026-09-08T00:00:00Z');

function ctx(over: Partial<SweepContext>): SweepContext {
  return {
    now: NOW,
    stablecoinBalance: usdc('2000'),
    yieldPositionValue: 0n,
    policy: POLICY,
    compliance: VERIFIED,
    upcomingObligations: [],
    lookaheadMs: 48 * 3600_000,
    ...over,
  };
}

describe('evaluateSweep — compliance gates', () => {
  it('does nothing when KYC is not verified', () => {
    const d = evaluateSweep(
      ctx({ compliance: { ...VERIFIED, kycStatus: 'pending' }, stablecoinBalance: usdc('50000') }),
    );
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/not allowlisted/);
  });

  it('does nothing when KYC is revoked even with huge idle balance', () => {
    const d = evaluateSweep(
      ctx({ compliance: { ...VERIFIED, kycStatus: 'revoked' }, stablecoinBalance: usdc('999999') }),
    );
    expect(d.action).toBe('none');
  });

  it('refuses to trade on a stale attestation', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('50000'),
        maxComplianceAgeMs: 24 * 3600_000,
        compliance: { ...VERIFIED, kycVerifiedAt: new Date('2026-08-01T00:00:00Z') },
      }),
    );
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/stale/);
  });

  it('accepts a fresh attestation within the max age', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('50000'),
        maxComplianceAgeMs: 30 * 24 * 3600_000,
        compliance: { ...VERIFIED, kycVerifiedAt: new Date('2026-09-06T00:00:00Z') },
      }),
    );
    expect(d.action).toBe('sweep_in');
  });
});

describe('evaluateSweep — sweep in', () => {
  it('parks idle balance above the buffer', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('8000') }));
    expect(d.action).toBe('sweep_in');
    expect(d.amount).toBe(usdc('6000'));
    expect(d.detail.cappedByMaxSweep).toBe(false);
  });

  it('caps a large idle amount at max-sweep-per-tx', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('50000') }));
    expect(d.action).toBe('sweep_in');
    expect(d.amount).toBe(usdc('10000'));
    expect(d.detail.cappedByMaxSweep).toBe(true);
  });

  it('reserves liquidity for obligations inside the lookahead window', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('8000'),
        upcomingObligations: [
          { id: 'rent', amount: usdc('3000'), dueAt: new Date('2026-09-09T00:00:00Z') },
        ],
      }),
    );
    // 8000 - (2000 buffer + 3000 rent) = 3000 idle
    expect(d.action).toBe('sweep_in');
    expect(d.amount).toBe(usdc('3000'));
    expect(d.detail.obligationsInWindow).toBe(1);
  });

  it('ignores obligations beyond the lookahead window', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('8000'),
        upcomingObligations: [
          { id: 'far', amount: usdc('5000'), dueAt: new Date('2026-10-01T00:00:00Z') },
        ],
      }),
    );
    expect(d.action).toBe('sweep_in');
    expect(d.amount).toBe(usdc('6000'));
  });

  it('skips a sweep-in below the dust floor', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('2000.5'), minSweepAmount: usdc('10') }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/below minimum/);
  });

  it('does nothing when balance equals required liquidity', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('2000') }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/balanced/);
  });
});

describe('evaluateSweep — sweep out', () => {
  it('redeems to cover a shortfall against the buffer', () => {
    const d = evaluateSweep(
      ctx({ stablecoinBalance: usdc('500'), yieldPositionValue: usdc('20000') }),
    );
    expect(d.action).toBe('sweep_out');
    expect(d.amount).toBe(usdc('1500'));
  });

  it('redeems to cover an imminent obligation', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('2000'),
        yieldPositionValue: usdc('20000'),
        upcomingObligations: [
          { id: 'payroll', amount: usdc('9000'), dueAt: new Date('2026-09-08T12:00:00Z') },
        ],
      }),
    );
    expect(d.action).toBe('sweep_out');
    expect(d.amount).toBe(usdc('9000'));
  });

  it('is limited by the position value when the position is smaller than the shortfall', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('0'), yieldPositionValue: usdc('750') }));
    expect(d.action).toBe('sweep_out');
    expect(d.amount).toBe(usdc('750'));
  });

  it('is capped by max-sweep-per-tx on a large shortfall', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('0'),
        yieldPositionValue: usdc('100000'),
        upcomingObligations: [{ id: 'big', amount: usdc('80000'), dueAt: NOW }],
      }),
    );
    expect(d.action).toBe('sweep_out');
    expect(d.amount).toBe(usdc('10000'));
    expect(d.detail.cappedByMaxSweep).toBe(true);
  });

  it('does nothing on a shortfall with no position to redeem', () => {
    const d = evaluateSweep(ctx({ stablecoinBalance: usdc('500'), yieldPositionValue: 0n }));
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/no yield position/);
  });

  it('treats a past-due obligation as needing liquidity now', () => {
    const d = evaluateSweep(
      ctx({
        stablecoinBalance: usdc('2000'),
        yieldPositionValue: usdc('5000'),
        upcomingObligations: [
          { id: 'overdue', amount: usdc('1000'), dueAt: new Date('2026-09-01T00:00:00Z') },
        ],
      }),
    );
    expect(d.action).toBe('sweep_out');
    expect(d.amount).toBe(usdc('1000'));
  });
});
