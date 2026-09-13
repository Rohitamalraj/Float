import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.js';

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument('https://gw.example', 0.01);

  it('is a valid-shaped OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBeTruthy();
    expect(doc.servers).toEqual([{ url: 'https://gw.example' }]);
  });

  it('derives servers[0].url from whatever host is passed in — no hardcoded domain', () => {
    const other = buildOpenApiDocument('https://random-tunnel.trycloudflare.com', 0.01);
    expect(other.servers).toEqual([{ url: 'https://random-tunnel.trycloudflare.com' }]);
  });

  it('describes both real routes', () => {
    expect(doc.paths['/v1/check'].post.operationId).toBe('checkSweep');
    expect(doc.paths['/v1/policy/{ensName}'].get.operationId).toBe('getPolicy');
  });

  it('carries the configured x402 price on the metered route', () => {
    const priced = buildOpenApiDocument('https://gw.example', 0.05);
    expect(priced.paths['/v1/check'].post['x-payment'].amount).toBe('0.05 USDC');
  });
});
