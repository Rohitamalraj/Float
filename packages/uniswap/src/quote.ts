import type { PublicClient } from 'viem';
import type { FloatDeployment } from '@float/contracts-sdk';
import { v4QuoterAbi } from './abis.js';
import {
  buildFloatPoolKey,
  resolveFloatVenue,
  zeroForOneFor,
  type FloatVenue,
  type SweepDirection,
} from './pool.js';

const BPS = 10_000n;

/** `amountOut * (1 - slippageBps/10000)`, rounded down. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error(`slippageBps out of range: ${slippageBps}`);
  }
  return (amountOut * (BPS - BigInt(slippageBps))) / BPS;
}

export interface QuoteParams {
  publicClient: PublicClient;
  deployment: Pick<FloatDeployment, 'usdc' | 'permissionsAdapter'>;
  direction: SweepDirection;
  /** Exact input amount, base units (USDC for `in`, FloatUSTB for `out`). */
  amountIn: bigint;
  venue?: FloatVenue;
}

export interface QuoteResult {
  amountOut: bigint;
  gasEstimate: bigint;
}

/**
 * Quote an exact-input single-hop swap on Float's permissioned pool, via the v4
 * V4Quoter lens. The quoter is a state-mutating function that is meant to be
 * `eth_call`-ed — `simulateContract` handles that.
 */
export async function quoteSweep(params: QuoteParams): Promise<QuoteResult> {
  const venue = params.venue ?? resolveFloatVenue();
  const poolKey = buildFloatPoolKey(params.deployment, venue);
  const zeroForOne = zeroForOneFor(params.direction, params.deployment);

  const { result } = await params.publicClient.simulateContract({
    address: venue.v4Quoter,
    abi: v4QuoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey,
        zeroForOne,
        exactAmount: params.amountIn,
        hookData: '0x',
      },
    ],
  });

  const [amountOut, gasEstimate] = result;
  return { amountOut, gasEstimate };
}

export interface SweepQuote extends QuoteResult {
  /** `amountOut` reduced by `slippageBps` — pass as the executor's `minOut` arg. */
  minOut: bigint;
  slippageBps: number;
}

/** Quote plus the `minOut` to hand `FloatSweepExecutor.sweepIn/sweepOut`. */
export async function quoteSweepMinOut(
  params: QuoteParams & { slippageBps?: number },
): Promise<SweepQuote> {
  const slippageBps = params.slippageBps ?? 50;
  const q = await quoteSweep(params);
  return { ...q, minOut: applySlippage(q.amountOut, slippageBps), slippageBps };
}
