import { describe, expect, it } from 'vitest';
import { connectionFor, sweepIdempotencyKey } from './queues.js';

describe('sweepIdempotencyKey', () => {
  it('buckets by the hour so only one sweep per business/direction/hour', () => {
    const t0 = Date.UTC(2026, 8, 10, 14, 5, 0);
    const t1 = Date.UTC(2026, 8, 10, 14, 55, 0);
    const t2 = Date.UTC(2026, 8, 10, 15, 1, 0);
    expect(sweepIdempotencyKey('biz-1', 'in', t0)).toBe(sweepIdempotencyKey('biz-1', 'in', t1));
    expect(sweepIdempotencyKey('biz-1', 'in', t0)).not.toBe(sweepIdempotencyKey('biz-1', 'in', t2));
    expect(sweepIdempotencyKey('biz-1', 'in', t0)).not.toBe(
      sweepIdempotencyKey('biz-1', 'out', t0),
    );
    expect(sweepIdempotencyKey('biz-1', 'in', t0)).not.toBe(sweepIdempotencyKey('biz-2', 'in', t0));
  });
});

describe('connectionFor', () => {
  it('maps a RedisConnection and disables per-request retries for workers', () => {
    const c = connectionFor({ host: 'r', port: 6380, password: 'p', db: 2 });
    expect(c).toMatchObject({
      host: 'r',
      port: 6380,
      password: 'p',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });
});
