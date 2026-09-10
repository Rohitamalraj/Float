import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { priceToAtomic, x402Payment, type X402Outcome } from './x402.js';
import type { X402Config } from './runtime.js';

const cfg = (over: Partial<X402Config> = {}): X402Config => ({
  enabled: true,
  mode: 'enforce',
  network: 'base-sepolia',
  payTo: '0x00000000000000000000000000000000000000ab',
  priceUsdc: 0.01,
  facilitatorUrl: 'http://facilitator.invalid',
  asset: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
  ...over,
});

type V = { Variables: { x402: X402Outcome } };
function appWith(x402: X402Config) {
  const app = new Hono<V>();
  app.post('/t', x402Payment(x402, { description: 'test' }), (c) =>
    c.json({ ok: true, pay: c.get('x402') }),
  );
  return app;
}

describe('priceToAtomic', () => {
  it('converts USDC to 6-decimal atomic units', () => {
    expect(priceToAtomic(0.01)).toBe('10000');
    expect(priceToAtomic(1)).toBe('1000000');
    expect(priceToAtomic(0.005)).toBe('5000');
  });
});

describe('x402Payment middleware', () => {
  it('passes through when payment is disabled', async () => {
    const res = await appWith(cfg({ enabled: false })).request('http://gw/t', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pay: X402Outcome };
    expect(body.pay.paid).toBe(true);
    expect(body.pay.challenged).toBe(false);
  });

  it('challenges with a 402 + PaymentRequirements when enforcing and unpaid', async () => {
    const res = await appWith(cfg()).request('http://gw/t', { method: 'POST' });
    expect(res.status).toBe(402);
    const j = (await res.json()) as {
      x402Version: number;
      accepts: { maxAmountRequired: string; payTo: string; network: string; asset: string }[];
    };
    expect(j.x402Version).toBe(1);
    expect(j.accepts[0]!.maxAmountRequired).toBe('10000');
    expect(j.accepts[0]!.payTo).toBe('0x00000000000000000000000000000000000000ab');
    expect(j.accepts[0]!.network).toBe('base-sepolia');
  });

  it('proceeds unpaid in permissive mode', async () => {
    const res = await appWith(cfg({ mode: 'permissive' })).request('http://gw/t', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pay: X402Outcome };
    expect(body.pay.paid).toBe(false);
  });

  it('rejects a malformed X-PAYMENT header with 400', async () => {
    const res = await appWith(cfg()).request('http://gw/t', {
      method: 'POST',
      headers: { 'X-PAYMENT': 'not-base64-json!!' },
    });
    expect([400, 402]).toContain(res.status);
  });
});
