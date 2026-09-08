import type { Obligation, SweepContext, SweepDecision, SweepDecisionDetail } from './types.js';
import { USDC_DECIMALS } from './types.js';

const ZERO = 0n;

function fmt(n: bigint): string {
  // Compact fixed-point rendering for logs; not for on-chain math.
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function clampMin(n: bigint, min: bigint): bigint {
  return n < min ? min : n;
}

function min(...xs: bigint[]): bigint {
  return xs.reduce((a, b) => (b < a ? b : a));
}

/** Sum of obligations whose due date falls within `[now, now + lookaheadMs]`. */
export function reservedForObligations(
  obligations: readonly Obligation[],
  now: Date,
  lookaheadMs: number,
): { total: bigint; count: number } {
  const horizon = now.getTime() + lookaheadMs;
  let total = ZERO;
  let count = 0;
  for (const o of obligations) {
    const due = o.dueAt.getTime();
    // Past-due and in-window obligations both need liquidity now.
    if (due <= horizon) {
      total += o.amount;
      count += 1;
    }
  }
  return { total, count };
}

/**
 * Pure sweep-decision engine. Shared verbatim by the agent service (which then
 * builds + signs the UserOperation) and the Bazantic `/v1/check` endpoint.
 *
 * It never authorises anything — Layer 1 (the session-key call policy) is the
 * cryptographic backstop. This function only decides *whether* and *how much*.
 */
export function evaluateSweep(ctx: SweepContext): SweepDecision {
  const { policy, compliance } = ctx;
  const minSweep = ctx.minSweepAmount ?? ZERO;

  const { total: reserved, count: obligationsInWindow } = reservedForObligations(
    ctx.upcomingObligations,
    ctx.now,
    ctx.lookaheadMs,
  );
  const requiredLiquidity = policy.bufferAmount + reserved;
  const idle = ctx.stablecoinBalance - requiredLiquidity;
  const shortfall = requiredLiquidity - ctx.stablecoinBalance;

  const detail: SweepDecisionDetail = {
    balance: fmt(ctx.stablecoinBalance),
    buffer: fmt(policy.bufferAmount),
    reservedForObligations: fmt(reserved),
    requiredLiquidity: fmt(requiredLiquidity),
    idle: fmt(idle > ZERO ? idle : ZERO),
    shortfall: fmt(shortfall > ZERO ? shortfall : ZERO),
    cappedByMaxSweep: false,
    obligationsInWindow,
  };

  const none = (reason: string): SweepDecision => ({
    action: 'none',
    amount: ZERO,
    reason,
    detail,
  });

  // ── Compliance gates ──────────────────────────────────────────────────────
  if (compliance.kycStatus !== 'verified') {
    return none(`not allowlisted (kyc-status=${compliance.kycStatus})`);
  }
  if (ctx.maxComplianceAgeMs !== undefined) {
    const verifiedAt = compliance.kycVerifiedAt?.getTime();
    if (verifiedAt === undefined) {
      return none('compliance attestation missing a verification timestamp');
    }
    if (ctx.now.getTime() - verifiedAt > ctx.maxComplianceAgeMs) {
      return none('compliance attestation is stale — re-verification required');
    }
  }

  // ── Sweep in: park idle balance above the required liquidity line ──────────
  if (idle > ZERO) {
    const capped = idle > policy.maxSweepPerTx;
    const amount = capped ? policy.maxSweepPerTx : idle;
    if (amount < minSweep) {
      return none(`idle ${fmt(idle)} below minimum sweep ${fmt(minSweep)}`);
    }
    return {
      action: 'sweep_in',
      amount,
      reason: capped
        ? `parking ${fmt(amount)} USDC (idle ${fmt(idle)} capped at max-sweep-per-tx)`
        : `parking ${fmt(amount)} USDC of idle balance`,
      detail: { ...detail, cappedByMaxSweep: capped },
    };
  }

  // ── Sweep out: cover a shortfall against buffer + upcoming obligations ─────
  if (shortfall > ZERO && ctx.yieldPositionValue > ZERO) {
    const capped = shortfall > policy.maxSweepPerTx;
    const amount = min(shortfall, ctx.yieldPositionValue, policy.maxSweepPerTx);
    // Always act on a shortfall even if small — an obligation may be due — but
    // still respect a dust floor unless the position is being fully drained.
    const drainingPosition = amount >= ctx.yieldPositionValue;
    if (amount < clampMin(minSweep, 1n) && !drainingPosition) {
      return none(`shortfall ${fmt(shortfall)} below minimum sweep ${fmt(minSweep)}`);
    }
    return {
      action: 'sweep_out',
      amount,
      reason: capped
        ? `redeeming ${fmt(amount)} USDC (shortfall ${fmt(shortfall)} capped at max-sweep-per-tx)`
        : `redeeming ${fmt(amount)} USDC to restore required liquidity`,
      detail: { ...detail, cappedByMaxSweep: capped },
    };
  }

  if (shortfall > ZERO) {
    return none(`shortfall ${fmt(shortfall)} but no yield position to redeem`);
  }
  return none('balanced — liquidity matches buffer + obligations');
}
