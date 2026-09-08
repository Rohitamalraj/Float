import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache, rpcUrlFor } from './env.js';

const SNAPSHOT = { ...process.env };

describe('loadEnv', () => {
  beforeEach(() => {
    resetEnvCache();
    process.env.DOTENV_PATH = '/nonexistent/.env'; // isolate from repo .env
  });

  afterEach(() => {
    process.env = { ...SNAPSHOT };
    resetEnvCache();
  });

  it('applies defaults when nothing is set', () => {
    const env = loadEnv();
    expect(env.FLOAT_CHAIN).toBe('sepolia');
    expect(env.GATEWAY_PORT).toBe(8402);
    expect(env.X402_PRICE_USDC).toBeCloseTo(0.01);
    expect(env.ADMIN_ALLOWLIST).toEqual([]);
  });

  it('rejects malformed private keys', () => {
    process.env.DEPLOYER_PRIVATE_KEY = '0xnothex';
    expect(() => loadEnv()).toThrow(/Invalid Float environment/);
  });

  it('parses the admin allowlist into a lowercased array', () => {
    process.env.ADMIN_ALLOWLIST = '0xAbC, Foo@Bar.com ,';
    expect(loadEnv().ADMIN_ALLOWLIST).toEqual(['0xabc', 'foo@bar.com']);
  });

  it('selects the RPC url for the active chain', () => {
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
    expect(rpcUrlFor('sepolia', loadEnv())).toBe('https://sepolia.example');
  });
});
