import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@float/config';
import { resolveFloatDeployment, tryResolveFloatDeployment } from './addresses.js';

const SNAPSHOT = { ...process.env };
const A = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;

describe('resolveFloatDeployment', () => {
  beforeEach(() => {
    resetEnvCache();
    process.env = {
      DOTENV_PATH: '/nonexistent/.env',
      FLOAT_CHAIN: 'sepolia',
      FLOAT_COMPLIANCE_REGISTRY_ADDRESS: A('1'),
      FLOAT_ALLOWLIST_CHECKER_ADDRESS: A('2'),
      FLOAT_POLICY_VIEW_ADDRESS: A('3'),
      FLOAT_SWEEP_EXECUTOR_ADDRESS: A('4'),
      FLOAT_USTB_ADDRESS: A('5'),
      FLOAT_YIELD_RESERVE_ADDRESS: A('6'),
      FLOAT_PERMISSIONS_ADAPTER_ADDRESS: A('7'),
    };
  });
  afterEach(() => {
    process.env = { ...SNAPSHOT };
    resetEnvCache();
  });

  it('resolves every Float address and defaults USDC from the chain config', () => {
    const d = resolveFloatDeployment();
    expect(d.chainId).toBe(11155111);
    expect(d.complianceRegistry).toBe('0x1111111111111111111111111111111111111111');
    expect(d.sweepExecutor).toBe('0x4444444444444444444444444444444444444444');
    // Sepolia test USDC from @float/config
    expect(d.usdc.toLowerCase()).toBe('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238');
    expect(d.poolId).toBeUndefined();
  });

  it('throws MissingConfigError when a Float address is unset', () => {
    delete process.env.FLOAT_SWEEP_EXECUTOR_ADDRESS;
    resetEnvCache();
    expect(() => resolveFloatDeployment()).toThrow(/FLOAT_SWEEP_EXECUTOR_ADDRESS/);
    expect(tryResolveFloatDeployment()).toBeUndefined();
  });
});
