import { decodeFunctionData, getAddress, parseUnits, zeroAddress } from 'viem';
import { namehash } from 'viem/ens';
import { describe, expect, it } from 'vitest';
import type { SweepPolicy } from '@float/core';
import { v2RegistryAbi, verifiableFactoryAbi } from './abis.js';
import { resolveEnsDeployment } from './deployment.js';
import { planBusinessProvisioning, planParentSubregistry } from './provision.js';
import { V2_BUSINESS_OWNER_ROLE_BITMAP } from './roles.js';

const deployment = resolveEnsDeployment('sepolia');
const PROVISIONER = getAddress('0x00000000000000000000000000000000000000f0');
const SMART_ACCOUNT = getAddress('0x1111111111111111111111111111111111111111');
const OWNER_KEY = getAddress('0x2222222222222222222222222222222222222222');
const ORACLE_KEY = getAddress('0x3333333333333333333333333333333333333333');
const PARENT_REGISTRY = getAddress('0x4444444444444444444444444444444444444444');

describe('resolveEnsDeployment', () => {
  it('has the canonical Sepolia ENS v2 addresses', () => {
    expect(deployment.registry).toBe('0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2');
    expect(deployment.resolverFactory).toBe('0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef');
  });
  it('throws on mainnet (ENS v2 not deployed)', () => {
    expect(() => resolveEnsDeployment('mainnet')).toThrow(/not deployed/);
  });
});

describe('planBusinessProvisioning', () => {
  const policy: SweepPolicy = {
    bufferAmount: parseUnits('2000', 6),
    maxSweepPerTx: parseUnits('10000', 6),
    allowedProtocol: getAddress('0x00000000000000000000000000000000000000c3'),
    targetYieldToken: getAddress('0x00000000000000000000000000000000000000d4'),
  };

  const plan = planBusinessProvisioning({
    deployment,
    ensName: 'rosa-design.float.eth',
    parentRegistry: PARENT_REGISTRY,
    smartAccount: SMART_ACCOUNT,
    provisioner: PROVISIONER,
    ownerKey: OWNER_KEY,
    oracleKey: ORACLE_KEY,
    initialPolicy: policy,
  });

  it('computes a deterministic Float-controlled resolver and the subname node', () => {
    expect(plan.node).toBe(namehash('rosa-design.float.eth'));
    expect(plan.resolver).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(plan.ref.resolver).toBe(plan.resolver);
  });

  it('orders steps: deploy resolver -> register -> addr+roles -> policy', () => {
    expect(plan.steps.map((s) => `${s.signer}:${s.description.split(' ')[0]}`)).toEqual([
      'provisioner:deploy',
      'provisioner:register',
      'provisioner:set',
      'owner:set',
    ]);
  });

  it('step 1 deploys the resolver proxy via the VerifiableFactory', () => {
    const call = plan.steps[0]!.calls[0]!;
    expect(call.to).toBe(deployment.resolverFactory);
    const d = decodeFunctionData({ abi: verifiableFactoryAbi, data: call.data });
    expect(d.functionName).toBe('deployProxy');
    expect(d.args[0]).toBe(deployment.resolverImplementation);
  });

  it('step 2 registers the subname to the smart account with the owner role bitmap', () => {
    const call = plan.steps[1]!.calls[0]!;
    expect(call.to).toBe(PARENT_REGISTRY);
    const d = decodeFunctionData({ abi: v2RegistryAbi, data: call.data });
    expect(d.functionName).toBe('register');
    expect(d.args[0]).toBe('rosa-design');
    expect(d.args[1]).toBe(SMART_ACCOUNT);
    expect(d.args[2]).toBe(zeroAddress);
    expect(d.args[3]).toBe(plan.resolver);
    expect(d.args[4]).toBe(V2_BUSINESS_OWNER_ROLE_BITMAP);
  });

  it('omits the policy step when no initial policy is given', () => {
    const p = planBusinessProvisioning({
      deployment,
      ensName: 'x.float.eth',
      parentRegistry: PARENT_REGISTRY,
      smartAccount: SMART_ACCOUNT,
      provisioner: PROVISIONER,
      ownerKey: OWNER_KEY,
      oracleKey: ORACLE_KEY,
    });
    expect(p.steps).toHaveLength(3);
  });
});

describe('planParentSubregistry', () => {
  it('deploys a UserRegistry proxy then wires it onto the parent', () => {
    const { steps, subregistry } = planParentSubregistry({
      deployment,
      parentName: 'float.eth',
      parentTokenId: 123n,
      provisioner: PROVISIONER,
    });
    expect(subregistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(steps).toHaveLength(2);
    const wire = decodeFunctionData({ abi: v2RegistryAbi, data: steps[1]!.calls[0]!.data });
    expect(wire.functionName).toBe('setSubregistry');
    expect(wire.args).toEqual([123n, subregistry]);
  });
});
