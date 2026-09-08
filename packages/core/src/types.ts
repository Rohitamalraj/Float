import type { Address } from 'viem';
import type { Accreditation, KycStatus } from '@float/config';

/** USDC has 6 decimals across every chain Float touches. */
export const USDC_DECIMALS = 6;

export type SweepAction = 'sweep_in' | 'sweep_out' | 'none';

/**
 * Layer 2 policy — the business-editable "current settings" mirrored from the
 * ENS policy records. Always sits inside the Layer 1 cryptographic ceiling.
 */
export interface SweepPolicy {
  /** Working capital to always keep liquid, USDC base units. */
  bufferAmount: bigint;
  /** Hard ceiling for a single sweep, USDC base units. */
  maxSweepPerTx: bigint;
  /** PermissionsAdapter / pool the agent is allowed to route through. */
  allowedProtocol: Address;
  /** Yield token the overflow is parked in (e.g. FloatUSTB). */
  targetYieldToken: Address;
}

export interface ComplianceState {
  kycStatus: KycStatus;
  accreditation: Accreditation;
  /** When the attestation was last refreshed. Undefined = never / unknown. */
  kycVerifiedAt?: Date;
  allowlistId?: string;
}

export interface Obligation {
  id: string;
  /** USDC base units that must be liquid by `dueAt`. */
  amount: bigint;
  dueAt: Date;
}

export interface SweepContext {
  now: Date;
  /** USDC held directly by the business's smart account. */
  stablecoinBalance: bigint;
  /** Current USDC-equivalent value of the yield-token position (0 if none). */
  yieldPositionValue: bigint;
  policy: SweepPolicy;
  compliance: ComplianceState;
  /** Known future outflows; only those inside the lookahead window are reserved. */
  upcomingObligations: Obligation[];
  /** How far ahead to reserve for obligations, milliseconds. */
  lookaheadMs: number;
  /**
   * Refuse to trade if the compliance attestation is older than this (ms).
   * Undefined disables the staleness check.
   */
  maxComplianceAgeMs?: number;
  /** Sweeps smaller than this are skipped as gas dust, USDC base units. Default 0. */
  minSweepAmount?: bigint;
}

export interface SweepDecision {
  action: SweepAction;
  /** USDC base units to move. 0 when action is 'none'. */
  amount: bigint;
  /** Human-readable rationale (goes to logs, dashboard, and the gateway response). */
  reason: string;
  detail: SweepDecisionDetail;
}

export interface SweepDecisionDetail {
  balance: string;
  buffer: string;
  reservedForObligations: string;
  requiredLiquidity: string;
  idle: string;
  shortfall: string;
  cappedByMaxSweep: boolean;
  obligationsInWindow: number;
}
