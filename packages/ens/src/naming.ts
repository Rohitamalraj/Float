import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { namehash, packetToBytes } from 'viem/ens';

/** DNS wire-format encoding of a name — the `bytes name` arg EAC authorize* calls take. */
export function dnsEncodeName(name: string): Hex {
  return toHex(packetToBytes(name));
}

export { namehash };

export interface SplitName {
  label: string;
  parent: string;
}

/** `rosa-design.float.eth` -> { label: 'rosa-design', parent: 'float.eth' }. */
export function splitSubname(name: string): SplitName {
  const dot = name.indexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    throw new Error(`"${name}" is not a subname (expected label.parent…).`);
  }
  return { label: name.slice(0, dot), parent: name.slice(dot + 1) };
}

// ── VerifiableFactory CREATE2 address prediction (ported from ensdomains/ens-cli) ──

const OWNED_RESOLVER_ID = keccak256(stringToBytes('OwnedResolver'));
const USER_REGISTRY_ID = keccak256(stringToBytes('UserRegistry'));

export function ownedResolverSalt(owner: Address, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
        [OWNED_RESOLVER_ID, owner, version],
      ),
    ),
  );
}

export function userRegistrySalt(parentName: string, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
        [USER_REGISTRY_ID, namehash(parentName), version],
      ),
    ),
  );
}

export interface PredictProxyParams {
  factory: Address;
  /** EIP-1167 proxy logic address (ENS v2 `resolverProxyLogic`). */
  proxyLogic: Address;
  /** Account that will send the `deployProxy` tx. */
  deployer: Address;
  salt: bigint;
}

export interface PredictedProxy {
  address: Address;
  salt: bigint;
  outerSalt: Hex;
}

/** Predict the CREATE2 address `VerifiableFactory.deployProxy` will produce. */
export function predictProxyAddress(params: PredictProxyParams): PredictedProxy {
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [params.deployer, params.salt]),
  );
  const bytecode = concat([
    '0x3d604d80600a3d3981f3363d3d373d3d3d363d73',
    params.proxyLogic,
    '0x5af43d82803e903d91602b57fd5bf3',
    outerSalt,
  ]);
  return {
    address: getContractAddress({
      bytecode,
      from: params.factory,
      opcode: 'CREATE2',
      salt: outerSalt,
    }),
    salt: params.salt,
    outerSalt,
  };
}
