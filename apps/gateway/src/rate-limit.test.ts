import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit } from './rate-limit.js';

function appWith(max: number) {
  const app = new Hono();
  app.get('/t', rateLimit({ windowMs: 60_000, max, keyPrefix: 'test' }), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

describe('rateLimit', () => {
  it('allows up to `max` requests per window', async () => {
    const app = appWith(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.request('http://gw/t');
      expect(res.status).toBe(200);
    }
  });

  it('rejects the request after the budget is exhausted, with Retry-After', async () => {
    const app = appWith(2);
    await app.request('http://gw/t');
    await app.request('http://gw/t');
    const res = await app.request('http://gw/t');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it('separates callers by x-forwarded-for', async () => {
    const app = appWith(1);
    const a = await app.request('http://gw/t', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const b = await app.request('http://gw/t', { headers: { 'x-forwarded-for': '2.2.2.2' } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aAgain = await app.request('http://gw/t', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(aAgain.status).toBe(429);
  });

  it('two independent limiter instances never share a budget', async () => {
    const routeA = appWith(1);
    const routeB = appWith(1);
    expect((await routeA.request('http://gw/t')).status).toBe(200);
    expect((await routeB.request('http://gw/t')).status).toBe(200);
    expect((await routeA.request('http://gw/t')).status).toBe(429);
  });
});
