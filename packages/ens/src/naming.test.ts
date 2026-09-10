import { getAddress, hexToBytes, isAddress } from 'viem';
import { namehash } from 'viem/ens';
import { describe, expect, it } from 'vitest';
import {
  dnsEncodeName,
  ownedResolverSalt,
  predictProxyAddress,
  splitSubname,
  userRegistrySalt,
} from './naming.js';

const FACTORY = getAddress('0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef');
const PROXY_LOGIC = getAddress('0xA136BeE4E37B44586242e516a39893EfD54315e9');
const OWNER_A = getAddress('0x00000000000000000000000000000000000000a1');
const OWNER_B = getAddress('0x00000000000000000000000000000000000000b2');

describe('dnsEncodeName', () => {
  it('length-prefixes each label and null-terminates', () => {
    const dns = dnsEncodeName('rosa-design.float.eth');
    const bytes = hexToBytes(dns);
    expect(bytes[0]).toBe('rosa-design'.length);
    expect(bytes[bytes.length - 1]).toBe(0);
    // "rosa-design"(11) + 1 + "float"(5) + 1 + "eth"(3) + 1 + root(1)
    expect(bytes.length).toBe(11 + 1 + 5 + 1 + 3 + 1 + 1);
  });
});

describe('splitSubname', () => {
  it('splits on the first label', () => {
    expect(splitSubname('rosa-design.float.eth')).toEqual({
      label: 'rosa-design',
      parent: 'float.eth',
    });
  });
  it('rejects bare 2LDs', () => {
    expect(() => splitSubname('float.eth')).not.toThrow();
    expect(() => splitSubname('eth')).toThrow();
  });
});

describe('predictProxyAddress', () => {
  const salt = ownedResolverSalt(OWNER_A);

  it('is deterministic', () => {
    const a = predictProxyAddress({
      factory: FACTORY,
      proxyLogic: PROXY_LOGIC,
      deployer: OWNER_A,
      salt,
    });
    const b = predictProxyAddress({
      factory: FACTORY,
      proxyLogic: PROXY_LOGIC,
      deployer: OWNER_A,
      salt,
    });
    expect(a.address).toBe(b.address);
    expect(isAddress(a.address)).toBe(true);
  });

  it('depends on the owner salt and the deployer', () => {
    const base = predictProxyAddress({
      factory: FACTORY,
      proxyLogic: PROXY_LOGIC,
      deployer: OWNER_A,
      salt,
    });
    const otherSalt = predictProxyAddress({
      factory: FACTORY,
      proxyLogic: PROXY_LOGIC,
      deployer: OWNER_A,
      salt: ownedResolverSalt(OWNER_B),
    });
    const otherDeployer = predictProxyAddress({
      factory: FACTORY,
      proxyLogic: PROXY_LOGIC,
      deployer: OWNER_B,
      salt,
    });
    expect(base.address).not.toBe(otherSalt.address);
    expect(base.address).not.toBe(otherDeployer.address);
  });

  it('salts differ by owner / by parent name', () => {
    expect(ownedResolverSalt(OWNER_A)).not.toBe(ownedResolverSalt(OWNER_B));
    expect(userRegistrySalt('float.eth')).not.toBe(userRegistrySalt('other.eth'));
    expect(userRegistrySalt('float.eth')).toBe(userRegistrySalt('float.eth'));
  });
});

describe('namehash re-export', () => {
  it('matches viem', () => {
    expect(namehash('float.eth')).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
