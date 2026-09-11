import { getConnInfo } from '@hono/node-server/conninfo';
import type { MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Distinguishes buckets across routes sharing one limiter instance. */
  keyPrefix: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** `getConnInfo` needs a live Node socket — absent under fetch-style test
 *  harnesses (and any non-Node runtime), so this never throws. */
function socketAddress(c: Parameters<MiddlewareHandler>[0]): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/**
 * Fixed-window in-memory rate limiter, keyed by caller IP. `/v1/check` is
 * already economically throttled by x402 payment; this guards the free
 * `/v1/policy/:ensName` route and caps pre-payment 402-challenge spam on
 * `/v1/check` itself.
 *
 * Single-process only — a multi-instance gateway deployment should move this
 * to a shared store (Redis) instead. See docs/runbook.md.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || socketAddress(c) || 'unknown';
    const key = `${opts.keyPrefix}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ error: 'rate limit exceeded, try again later' }, 429);
    }

    // Opportunistic cleanup so long-running processes don't leak buckets.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }

    await next();
  };
}
