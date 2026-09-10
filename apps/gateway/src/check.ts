import { eq } from 'drizzle-orm';
import {
  formatUnits,
  getAddress,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { USDC_DECIMALS } from '@float/core';
import {
  evaluateSweep,
  reservedForObligations,
  type ComplianceState,
  type Obligation,
  type SweepDecisionDetail,
  type SweepPolicy,
} from '@float/core';
import { businesses, obligations as obligationsTable, type Database } from '@float/db';
import {
  floatContracts,
  readAttestation,
  readVaultValuation,
  type FloatDeployment,
} from '@float/contracts-sdk';
import {
  NameNotResolvableError,
  readParsedFloatState,
  resolveFloatName,
  type EnsDeployment,
} from '@float/ens';

export interface CheckDeps {
  publicClient: PublicClient;
  db: Database;
  deployment: FloatDeployment;
  ensDeployment?: EnsDeployment;
  maxComplianceAgeMs: number;
  /** Reserve this far ahead for obligations, ms. */
  lookaheadMs: number;
}

export interface CheckRequest {
  ensName: string;
  requestedAction?: 'sweep_in' | 'sweep_out';
  /** USDC, decimal string. */
  amount?: string;
}

export interface CheckResponse {
  ensName: string;
  smartAccount: Address;
  allowed: boolean;
  action: 'sweep_in' | 'sweep_out' | 'none';
  /** USDC decimal string — what the caller should actually sweep. */
  recommendedAmount: string;
  reason: string;
  compliance: { kycStatus: string; verified: boolean };
  policy: { bufferAmount: string; maxSweepPerTx: string; allowedProtocol: Address };
  detail?: SweepDecisionDetail;
}

export class CheckError extends Error {
  constructor(
    readonly status: 400 | 404 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'CheckError';
  }
}

const fmt = (n: bigint) => formatUnits(n, USDC_DECIMALS);
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

interface ResolvedTarget {
  smartAccount: Address;
  resolver: Address;
  node: Hex;
  businessId?: string;
}

async function resolveTarget(deps: CheckDeps, ensName: string): Promise<ResolvedTarget> {
  const [row] = await deps.db
    .select()
    .from(businesses)
    .where(eq(businesses.ensName, ensName.toLowerCase()))
    .limit(1);
  if (row?.smartAccountAddress && row.ensResolver && row.ensNode) {
    return {
      smartAccount: getAddress(row.smartAccountAddress),
      resolver: getAddress(row.ensResolver),
      node: row.ensNode as Hex,
      businessId: row.id,
    };
  }
  if (!deps.ensDeployment) throw new CheckError(404, `unknown business "${ensName}"`);
  try {
    const r = await resolveFloatName(deps.publicClient, deps.ensDeployment, ensName);
    if (r.smartAccount === zeroAddress)
      throw new CheckError(404, `"${ensName}" has no address record`);
    return {
      smartAccount: r.smartAccount,
      resolver: r.resolver,
      node: r.node,
      businessId: row?.id,
    };
  } catch (err) {
    if (err instanceof NameNotResolvableError) throw new CheckError(404, err.message);
    throw err;
  }
}

export interface PolicySummary {
  ensName: string;
  smartAccount: Address;
  compliance: { kycStatus: string; verified: boolean; verifiedAt?: string; accreditation: string };
  policy: {
    bufferAmount: string;
    maxSweepPerTx: string;
    allowedProtocol: Address;
    targetYieldToken: Address;
  };
}

/** Free read-only view of a business's policy + compliance state. */
export async function readPolicySummary(deps: CheckDeps, ensName: string): Promise<PolicySummary> {
  if (!ensName) throw new CheckError(400, 'ensName is required');
  const target = await resolveTarget(deps, ensName);
  const contracts = floatContracts(deps.deployment, { public: deps.publicClient });
  const [attestation, parsed] = await Promise.all([
    readAttestation(contracts.complianceRegistry, target.smartAccount),
    readParsedFloatState(deps.publicClient, { resolver: target.resolver, node: target.node }),
  ]);
  if (!parsed.policy)
    throw new CheckError(422, `"${ensName}" has not configured a complete policy`);
  return {
    ensName,
    smartAccount: target.smartAccount,
    compliance: {
      kycStatus: attestation.status === 'none' ? 'pending' : attestation.status,
      verified: attestation.isVerified,
      verifiedAt: attestation.verifiedAt?.toISOString(),
      accreditation: attestation.accredited ? 'accredited' : 'unknown',
    },
    policy: {
      bufferAmount: fmt(parsed.policy.bufferAmount),
      maxSweepPerTx: fmt(parsed.policy.maxSweepPerTx),
      allowedProtocol: getAddress(parsed.policy.allowedProtocol),
      targetYieldToken: getAddress(parsed.policy.targetYieldToken),
    },
  };
}

/**
 * The metered product: "for this ENS-named Float business, is this sweep allowed
 * by its policy + compliance, and how much should you actually move?"
 */
export async function runCheck(deps: CheckDeps, req: CheckRequest): Promise<CheckResponse> {
  if (!req.ensName) throw new CheckError(400, 'ensName is required');
  const target = await resolveTarget(deps, req.ensName);
  const contracts = floatContracts(deps.deployment, { public: deps.publicClient });

  const [attestation, parsed, usdcBalance, ustbBalance] = await Promise.all([
    readAttestation(contracts.complianceRegistry, target.smartAccount),
    readParsedFloatState(deps.publicClient, { resolver: target.resolver, node: target.node }),
    contracts.usdc.read.balanceOf([target.smartAccount]),
    contracts.floatUstb.read.balanceOf([target.smartAccount]),
  ]);

  const policy: SweepPolicy | null = parsed.policy;
  if (!policy) throw new CheckError(422, `"${req.ensName}" has not configured a complete policy`);

  const compliance: ComplianceState = {
    kycStatus: attestation.status === 'none' ? 'pending' : attestation.status,
    accreditation: attestation.accredited ? 'accredited' : 'unknown',
    kycVerifiedAt: attestation.verifiedAt,
    allowlistId: attestation.allowlistId,
  };

  const base = {
    ensName: req.ensName,
    smartAccount: target.smartAccount,
    compliance: { kycStatus: compliance.kycStatus, verified: attestation.isVerified },
    policy: {
      bufferAmount: fmt(policy.bufferAmount),
      maxSweepPerTx: fmt(policy.maxSweepPerTx),
      allowedProtocol: policy.allowedProtocol,
    },
  };

  const now = new Date();
  const horizon = new Date(now.getTime() + deps.lookaheadMs);
  const obligationRows = target.businessId
    ? await deps.db
        .select()
        .from(obligationsTable)
        .where(eq(obligationsTable.businessId, target.businessId))
    : [];
  const upcoming: Obligation[] = obligationRows
    .filter((o) => ['scheduled', 'covered'].includes(o.status) && o.dueAt <= horizon)
    .map((o) => ({ id: o.id, amount: BigInt(o.amount), dueAt: o.dueAt }));

  const valuation = await readVaultValuation(contracts.floatUstb, ustbBalance);

  // ── auto path: delegate to the shared decision engine ────────────────────
  if (!req.requestedAction) {
    const decision = evaluateSweep({
      now,
      stablecoinBalance: usdcBalance,
      yieldPositionValue: valuation.redeemable,
      policy,
      compliance,
      upcomingObligations: upcoming,
      lookaheadMs: deps.lookaheadMs,
      maxComplianceAgeMs: deps.maxComplianceAgeMs,
    });
    return {
      ...base,
      allowed: decision.action !== 'none',
      action: decision.action,
      recommendedAmount: fmt(decision.amount),
      reason: decision.reason,
      detail: decision.detail,
    };
  }

  // ── requested path: validate a specific proposed sweep ───────────────────
  if (!attestation.isVerified) {
    return {
      ...base,
      allowed: false,
      action: 'none',
      recommendedAmount: '0',
      reason: `not allowlisted (kyc-status=${compliance.kycStatus})`,
    };
  }
  let amount: bigint;
  try {
    amount = parseUnits(req.amount ?? '0', USDC_DECIMALS);
  } catch {
    throw new CheckError(400, `amount is not a USDC value: ${req.amount}`);
  }
  if (amount <= 0n) throw new CheckError(400, 'amount must be positive');

  const { total: reserved } = reservedForObligations(upcoming, now, deps.lookaheadMs);
  const requiredLiquidity = policy.bufferAmount + reserved;

  if (req.requestedAction === 'sweep_in') {
    const idle = usdcBalance > requiredLiquidity ? usdcBalance - requiredLiquidity : 0n;
    const recommended = min(amount, idle, policy.maxSweepPerTx);
    const allowed = amount <= policy.maxSweepPerTx && amount <= idle;
    return {
      ...base,
      allowed,
      action: 'sweep_in',
      recommendedAmount: fmt(recommended),
      reason: allowed
        ? `within policy — ${fmt(recommended)} USDC of idle balance is sweepable`
        : amount > policy.maxSweepPerTx
          ? `exceeds max-sweep-per-tx (${fmt(policy.maxSweepPerTx)})`
          : `only ${fmt(idle)} USDC is idle above the required liquidity line`,
    };
  }

  // sweep_out
  const shortfall = requiredLiquidity > usdcBalance ? requiredLiquidity - usdcBalance : 0n;
  const recommended = min(amount, valuation.redeemable, policy.maxSweepPerTx);
  const allowed = amount <= policy.maxSweepPerTx && amount <= valuation.redeemable;
  return {
    ...base,
    allowed,
    action: 'sweep_out',
    recommendedAmount: fmt(recommended),
    reason: allowed
      ? shortfall > 0n
        ? `within policy — covers a ${fmt(shortfall)} USDC liquidity shortfall`
        : `within policy — ${fmt(recommended)} USDC redeemable`
      : amount > policy.maxSweepPerTx
        ? `exceeds max-sweep-per-tx (${fmt(policy.maxSweepPerTx)})`
        : `position only holds ${fmt(valuation.redeemable)} USDC of redeemable value`,
  };
}
