import {
  getContract,
  type Abi,
  type Address,
  type GetContractReturnType,
  type PublicClient,
  type WalletClient,
} from 'viem';
import {
  erc20Abi,
  floatAllowlistCheckerAbi,
  floatComplianceRegistryAbi,
  floatPolicyViewAbi,
  floatSweepExecutorAbi,
  floatUstbAbi,
  floatYieldReserveAbi,
} from './abis/index.js';
import type { FloatDeployment } from './addresses.js';

export interface FloatClients {
  public: PublicClient;
  wallet?: WalletClient;
}

type BoundClient = PublicClient | { public: PublicClient; wallet: WalletClient };

/** viem client shape `getContract` accepts (both, or just public). */
function pick(clients: FloatClients): BoundClient {
  return clients.wallet ? { public: clients.public, wallet: clients.wallet } : clients.public;
}

/** A `getContract` instance (read always; write/simulate/estimateGas when a wallet is bound). */
export type FloatContract<TAbi extends Abi> = GetContractReturnType<TAbi, BoundClient, Address>;

export type ComplianceRegistryContract = FloatContract<typeof floatComplianceRegistryAbi>;
export type AllowlistCheckerContract = FloatContract<typeof floatAllowlistCheckerAbi>;
export type PolicyViewContract = FloatContract<typeof floatPolicyViewAbi>;
export type SweepExecutorContract = FloatContract<typeof floatSweepExecutorAbi>;
export type FloatUstbContract = FloatContract<typeof floatUstbAbi>;
export type YieldReserveContract = FloatContract<typeof floatYieldReserveAbi>;
export type Erc20Contract = FloatContract<typeof erc20Abi>;

export function complianceRegistryAt(
  address: Address,
  clients: FloatClients,
): ComplianceRegistryContract {
  return getContract({ address, abi: floatComplianceRegistryAbi, client: pick(clients) });
}
export function allowlistCheckerAt(
  address: Address,
  clients: FloatClients,
): AllowlistCheckerContract {
  return getContract({ address, abi: floatAllowlistCheckerAbi, client: pick(clients) });
}
export function policyViewAt(address: Address, clients: FloatClients): PolicyViewContract {
  return getContract({ address, abi: floatPolicyViewAbi, client: pick(clients) });
}
export function sweepExecutorAt(address: Address, clients: FloatClients): SweepExecutorContract {
  return getContract({ address, abi: floatSweepExecutorAbi, client: pick(clients) });
}
export function floatUstbAt(address: Address, clients: FloatClients): FloatUstbContract {
  return getContract({ address, abi: floatUstbAbi, client: pick(clients) });
}
export function yieldReserveAt(address: Address, clients: FloatClients): YieldReserveContract {
  return getContract({ address, abi: floatYieldReserveAbi, client: pick(clients) });
}
export function erc20At(address: Address, clients: FloatClients): Erc20Contract {
  return getContract({ address, abi: erc20Abi, client: pick(clients) });
}

export interface FloatContracts {
  complianceRegistry: ComplianceRegistryContract;
  allowlistChecker: AllowlistCheckerContract;
  policyView: PolicyViewContract;
  sweepExecutor: SweepExecutorContract;
  floatUstb: FloatUstbContract;
  yieldReserve: YieldReserveContract;
  usdc: Erc20Contract;
}

/** Every Float contract, bound to `deployment`'s addresses. */
export function floatContracts(deployment: FloatDeployment, clients: FloatClients): FloatContracts {
  return {
    complianceRegistry: complianceRegistryAt(deployment.complianceRegistry, clients),
    allowlistChecker: allowlistCheckerAt(deployment.allowlistChecker, clients),
    policyView: policyViewAt(deployment.policyView, clients),
    sweepExecutor: sweepExecutorAt(deployment.sweepExecutor, clients),
    floatUstb: floatUstbAt(deployment.floatUstb, clients),
    yieldReserve: yieldReserveAt(deployment.yieldReserve, clients),
    usdc: erc20At(deployment.usdc, clients),
  };
}
