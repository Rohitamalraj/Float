import type { Context, MiddlewareHandler } from 'hono';
import { logger } from './logger.js';
import type { X402Config } from './runtime.js';

export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface X402Outcome {
  /** true if a payment was verified (or payment is disabled). */
  paid: boolean;
  challenged: boolean;
  payer?: string;
  settleTxHash?: string;
  amountAtomic: string;
}

/** 0.01 USDC -> "10000" (6-decimal atomic units). */
export function priceToAtomic(priceUsdc: number): string {
  return BigInt(Math.round(priceUsdc * 1_000_000)).toString();
}

function buildRequirements(
  x402: X402Config,
  resource: string,
  description: string,
): PaymentRequirements {
  return {
    scheme: 'exact',
    network: x402.network,
    maxAmountRequired: priceToAtomic(x402.priceUsdc),
    resource,
    description,
    mimeType: 'application/json',
    payTo: x402.payTo ?? '0x0000000000000000000000000000000000000000',
    maxTimeoutSeconds: 60,
    asset: x402.asset,
    extra: { name: 'USDC', version: '2' },
  };
}

async function facilitator<T>(
  base: string,
  path: '/verify' | '/settle',
  body: unknown,
): Promise<T> {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`facilitator ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}
interface SettleResult {
  success: boolean;
  transaction?: string;
  payer?: string;
  errorReason?: string;
}

/**
 * x402 payment gate for a Hono route. Emits a `402` challenge when payment is
 * missing (in `enforce` mode), verifies `X-PAYMENT` against the facilitator,
 * runs the handler, then settles and attaches `X-PAYMENT-RESPONSE`.
 *
 * `permissive` mode logs and proceeds unpaid — for local dev or when a hosted
 * gateway (Bazantic) already collected the payment upstream.
 */
export function x402Payment(x402: X402Config, opts: { description: string }): MiddlewareHandler {
  return async (c: Context, next) => {
    const outcome: X402Outcome = {
      paid: !x402.enabled,
      challenged: false,
      amountAtomic: priceToAtomic(x402.priceUsdc),
    };

    if (!x402.enabled) {
      c.set('x402', outcome);
      await next();
      return;
    }

    const resource = new URL(c.req.url).toString();
    const requirements = buildRequirements(x402, resource, opts.description);
    const header = c.req.header('X-PAYMENT');

    if (!header) {
      if (x402.mode === 'permissive') {
        logger.warn({ resource }, 'x402 permissive: proceeding without payment');
        c.set('x402', outcome);
        await next();
        return;
      }
      outcome.challenged = true;
      c.set('x402', outcome);
      return c.json(
        {
          x402Version: X402_VERSION,
          error: 'X-PAYMENT header is required',
          accepts: [requirements],
        },
        402,
      );
    }

    let paymentPayload: unknown;
    try {
      paymentPayload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
      return c.json({ x402Version: X402_VERSION, error: 'malformed X-PAYMENT header' }, 400);
    }

    let verify: VerifyResult;
    try {
      verify = await facilitator<VerifyResult>(x402.facilitatorUrl, '/verify', {
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements: requirements,
      });
    } catch (err) {
      logger.error({ err }, 'x402 verify failed');
      if (x402.mode === 'permissive') {
        c.set('x402', outcome);
        await next();
        return;
      }
      return c.json({ x402Version: X402_VERSION, error: 'payment verification unavailable' }, 502);
    }

    if (!verify.isValid) {
      outcome.challenged = true;
      c.set('x402', outcome);
      return c.json(
        {
          x402Version: X402_VERSION,
          error: verify.invalidReason ?? 'invalid payment',
          accepts: [requirements],
        },
        402,
      );
    }

    outcome.paid = true;
    outcome.payer = verify.payer;
    c.set('x402', outcome);

    await next();

    // settle after a successful response
    try {
      const settle = await facilitator<SettleResult>(x402.facilitatorUrl, '/settle', {
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements: requirements,
      });
      if (settle.success && settle.transaction) {
        outcome.settleTxHash = settle.transaction;
        outcome.payer = settle.payer ?? outcome.payer;
        c.header(
          'X-PAYMENT-RESPONSE',
          Buffer.from(JSON.stringify(settle), 'utf8').toString('base64'),
        );
      } else {
        logger.error({ reason: settle.errorReason }, 'x402 settle did not succeed');
      }
    } catch (err) {
      logger.error({ err }, 'x402 settle failed (payment was verified) — facilitator will retry');
    }
  };
}
