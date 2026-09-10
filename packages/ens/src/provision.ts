import {
  encodeFunctionData,
  getAddress,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import type { ComplianceState, SweepPolicy } from '@float/core';
import type { Call } from '@float/contracts-sdk';
import {
  permissionedResolverAbi,
  userRegistryAbi,
  v2RegistryAbi,
  verifiableFactoryAbi,
} from './abis.js';
import type { EnsDeployment } from './deployment.js';
import {
  ownedResolverSalt,
  predictProxyAddress,
  splitSubname,
  userRegistrySalt,
} from './naming.js';
import { ALL_RESOLVER_ROLES, MAX_UINT64, V2_BUSINESS_OWNER_ROLE_BITMAP } from './roles.js';
import {
  encodeAuthorizeRecordRoleSplit,
  encodeSetComplianceRecords,
  encodeSetPolicyRecords,
  encodeSetSmartAccount,
  type ResolverRef,
} from './resolver.js';

export type ProvisionSigner = 'provisioner' | 'owner' | 'oracle';

export interface ProvisionStep {
  signer: ProvisionSigner;
  description: string;
  calls: Call[];
}

// ── one-time: give a parent name (float.eth) a subregistry to hold subnames ──

export interface ParentSubregistryPlan {
  /** CREATE2 address the UserRegistry proxy will land at. */
  subregistry: Address;
  steps: ProvisionStep[];
}

export function planParentSubregistry(params: {
  deployment: EnsDeployment;
  parentName: string;
  /** tokenId of the parent name in `deployment.registry` (== BigInt(labelhash(label))). */
  parentTokenId: bigint;
  provisioner: Address;
}): ParentSubregistryPlan {
  const { deployment, provisioner } = params;
  const salt = userRegistrySalt(params.parentName);
  const predicted = predictProxyAddress({
    factory: deployment.resolverFactory,
    proxyLogic: deployment.resolverProxyLogic,
    deployer: provisioner,
    salt,
  });

  const initData = encodeFunctionData({
    abi: userRegistryAbi,
    functionName: 'initialize',
    args: [provisioner, ALL_RESOLVER_ROLES],
  });

  return {
    subregistry: predicted.address,
    steps: [
      {
        signer: 'provisioner',
        description: `deploy UserRegistry proxy for ${params.parentName}`,
        calls: [
          {
            to: deployment.resolverFactory,
            value: 0n,
            data: encodeFunctionData({
              abi: verifiableFactoryAbi,
              functionName: 'deployProxy',
              args: [deployment.subregistryImplementation, salt, initData],
            }),
          },
        ],
      },
      {
        signer: 'provisioner',
        description: `wire the subregistry onto ${params.parentName}`,
        calls: [
          {
            to: deployment.registry,
            value: 0n,
            data: encodeFunctionData({
              abi: v2RegistryAbi,
              functionName: 'setSubregistry',
              args: [params.parentTokenId, predicted.address],
            }),
          },
        ],
      },
    ],
  };
}

// ── per business: subname + Float-controlled resolver + record role split ────

export interface BusinessProvisionParams {
  deployment: EnsDeployment;
  /** e.g. `rosa-design.float.eth`. */
  ensName: string;
  /** `float.eth`'s subregistry (from {@link planParentSubregistry} or on-chain). */
  parentRegistry: Address;
  smartAccount: Address;
  /** Float key that deploys the resolver + registers the subname (needs the registrar role). */
  provisioner: Address;
  /** Business owner key — will be able to write only the policy records. */
  ownerKey: Address;
  /** Float compliance-oracle key — will be able to write only the compliance records. */
  oracleKey: Address;
  /** Subname expiry (unix seconds). Defaults to max uint64 (non-expiring). */
  expiry?: bigint;
  initialPolicy?: SweepPolicy;
  initialCompliance?: ComplianceState;
}

export interface BusinessProvisionPlan {
  ensName: string;
  node: Hex;
  /** The Float-controlled PermissionedResolver proxy this business's name will use. */
  resolver: Address;
  ref: ResolverRef;
  steps: ProvisionStep[];
}

export function planBusinessProvisioning(params: BusinessProvisionParams): BusinessProvisionPlan {
  const { deployment } = params;
  const { label } = splitSubname(params.ensName);
  const node = namehash(params.ensName);
  const smartAccount = getAddress(params.smartAccount);

  // A dedicated resolver proxy per business, admin'd by Float's provisioner so
  // neither the owner nor the oracle can revoke the other's record roles.
  const salt = ownedResolverSalt(smartAccount);
  const predicted = predictProxyAddress({
    factory: deployment.resolverFactory,
    proxyLogic: deployment.resolverProxyLogic,
    deployer: params.provisioner,
    salt,
  });
  const resolver = predicted.address;
  const ref: ResolverRef = { resolver, node };

  const resolverInit = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: 'initialize',
    args: [params.provisioner, ALL_RESOLVER_ROLES, []],
  });

  const steps: ProvisionStep[] = [
    {
      signer: 'provisioner',
      description: `deploy Float-controlled resolver for ${params.ensName}`,
      calls: [
        {
          to: deployment.resolverFactory,
          value: 0n,
          data: encodeFunctionData({
            abi: verifiableFactoryAbi,
            functionName: 'deployProxy',
            args: [deployment.resolverImplementation, salt, resolverInit],
          }),
        },
      ],
    },
    {
      signer: 'provisioner',
      description: `register ${params.ensName} to the smart account`,
      calls: [
        {
          to: params.parentRegistry,
          value: 0n,
          data: encodeFunctionData({
            abi: v2RegistryAbi,
            functionName: 'register',
            args: [
              label,
              smartAccount,
              zeroAddress,
              resolver,
              V2_BUSINESS_OWNER_ROLE_BITMAP,
              params.expiry ?? MAX_UINT64,
            ],
          }),
        },
      ],
    },
    {
      signer: 'provisioner',
      description: 'set addr record + split text-record write roles (owner ↔ oracle)',
      calls: [
        encodeSetSmartAccount(ref, smartAccount),
        encodeAuthorizeRecordRoleSplit(ref, {
          ensName: params.ensName,
          ownerKey: params.ownerKey,
          oracleKey: params.oracleKey,
        }),
      ],
    },
  ];

  if (params.initialPolicy) {
    steps.push({
      signer: 'owner',
      description: 'set initial policy records (buffer, max-sweep, protocols, yield token)',
      calls: [encodeSetPolicyRecords(ref, params.initialPolicy)],
    });
  }
  if (params.initialCompliance) {
    steps.push({
      signer: 'oracle',
      description: 'write initial compliance attestation records',
      calls: [encodeSetComplianceRecords(ref, params.initialCompliance)],
    });
  }

  return { ensName: params.ensName, node, resolver, ref, steps };
}

// ── reads ──────────────────────────────────────────────────────────────────

/** On-chain address of a parent name's subregistry (zero if it has none). */
export async function getSubregistry(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<Address> {
  return client.readContract({
    address: registry,
    abi: v2RegistryAbi,
    functionName: 'getSubregistry',
    args: [label],
  });
}
