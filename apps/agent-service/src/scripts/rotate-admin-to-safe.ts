/**
 * One-time: move Float's on-chain admin control from a single throwaway EOA
 * to a real Safe multisig (per docs/runbook.md §1's key-rotation target).
 *
 * Deploys a 2-owner Safe — [DEPLOYER_PRIVATE_KEY's address, SAFE_OWNER_ADDRESS
 * (a real wallet you control)] — starting at threshold 1 so this script can
 * finish the whole handover in one run using only the deployer key, then
 * raises the threshold to 2 as its last step. From that point on, no single
 * key (including the original deployer) can act alone.
 *
 * What moves to the Safe:
 *   - FloatUSTB.owner() / FloatYieldReserve.owner() (Ownable2Step)
 *   - DEFAULT_ADMIN_ROLE on FloatComplianceRegistry and FloatPolicyView
 * The deployer's admin rights are explicitly revoked/renounced on all four —
 * this is a real handover, not a copy.
 *
 *   ROTATE_CONFIRM=1 SAFE_OWNER_ADDRESS=0x... pnpm --filter @float/agent-service rotate-admin-to-safe
 */
import SafeKitDefault from '@safe-global/protocol-kit';
import { createWalletClient, encodeFunctionData, getAddress, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { floatContracts } from '@float/contracts-sdk';
import { logger } from '../logger.js';
import { getRuntime } from '../runtime.js';

/**
 * @safe-global/protocol-kit's package.json has no `"type": "module"` and no
 * separate .d.mts/.d.cts pair for its dual CJS/ESM build, which trips up
 * `moduleResolution: NodeNext` + `esModuleInterop` into losing the default
 * export's type entirely (a known class of issue with such packages — the
 * runtime import is fine, only the static type is wrong). This interface is
 * transcribed directly from the package's own `dist/src/Safe.d.ts`, not
 * guessed — cast the import to it rather than fight the resolver.
 */
interface SafeTransactionLike {
  data: { to: string; value: string; data: string; operation: number };
}
interface SafeInstance {
  getAddress(): Promise<string>;
  isSafeDeployed(): Promise<boolean>;
  createSafeDeploymentTransaction(): Promise<{ to: string; data: string; value?: string | number | bigint }>;
  connect(config: { safeAddress: string; signer?: string; provider?: string }): Promise<SafeInstance>;
  getOwners(): Promise<string[]>;
  getThreshold(): Promise<number>;
  createTransaction(props: {
    transactions: { to: string; value: string; data: string }[];
  }): Promise<SafeTransactionLike>;
  signTransaction(tx: SafeTransactionLike): Promise<SafeTransactionLike>;
  executeTransaction(tx: SafeTransactionLike): Promise<{ hash: string }>;
  createChangeThresholdTx(threshold: number): Promise<SafeTransactionLike>;
}
interface SafeStatic {
  init(config: {
    provider: string;
    signer: string;
    predictedSafe: { safeAccountConfig: { owners: string[]; threshold: number } };
  }): Promise<SafeInstance>;
}
const Safe = SafeKitDefault as unknown as SafeStatic;

async function main(): Promise<void> {
  const log = logger.child({ script: 'rotate-admin-to-safe' });
  if (process.env.ROTATE_CONFIRM !== '1') {
    throw new Error('refusing to run without ROTATE_CONFIRM=1');
  }
  const safeOwnerRaw = process.env.SAFE_OWNER_ADDRESS;
  if (!safeOwnerRaw) throw new Error('SAFE_OWNER_ADDRESS is not set');
  const safeOwner = getAddress(safeOwnerRaw);

  const rt = getRuntime();
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY is not set');
  const deployer = privateKeyToAccount(deployerKey);
  const rpcUrl = rt.env.SEPOLIA_RPC_URL;
  const deployerWallet = createWalletClient({ account: deployer, chain: rt.chain, transport: http(rpcUrl) });

  async function send(to: Address, data: Hex): Promise<Hex> {
    const hash = await deployerWallet.sendTransaction({ to, data, value: 0n });
    const receipt = await rt.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`);
    return hash;
  }

  // ── 1. deploy the Safe (threshold 1 for now — this script needs to act
  //      through it alone using just the deployer key) ────────────────────
  let safe = await Safe.init({
    provider: rpcUrl,
    signer: deployerKey,
    predictedSafe: {
      safeAccountConfig: { owners: [deployer.address, safeOwner], threshold: 1 },
    },
  });
  const safeAddress = getAddress(await safe.getAddress());
  log.info({ safeAddress, owners: [deployer.address, safeOwner] }, 'predicted Safe address');

  if (!(await safe.isSafeDeployed())) {
    const deployTx = await safe.createSafeDeploymentTransaction();
    const hash = await deployerWallet.sendTransaction({
      to: deployTx.to as Address,
      data: deployTx.data as Hex,
      value: BigInt(deployTx.value ?? 0),
    });
    await rt.publicClient.waitForTransactionReceipt({ hash });
    log.info({ safeAddress, hash }, 'Safe deployed');
  } else {
    log.info({ safeAddress }, 'Safe already deployed — resuming');
  }
  // .connect() drops the signer unless it's passed again — always reconnect
  // fully so every later write (accept ownership, change threshold) works,
  // on both a fresh deploy and a resumed run.
  safe = await safe.connect({ safeAddress, signer: deployerKey, provider: rpcUrl });

  // ── 2. hand the Ownable2Step contracts + AccessControl admin role to the Safe ──
  const contracts = floatContracts(rt.deployment, { public: rt.publicClient });
  const adminRole = await contracts.complianceRegistry.read.DEFAULT_ADMIN_ROLE();

  if ((await contracts.floatUstb.read.owner()).toLowerCase() !== safeAddress.toLowerCase()) {
    await send(
      rt.deployment.floatUstb,
      encodeFunctionData({
        abi: [{ type: 'function', name: 'transferOwnership', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] }] as const,
        functionName: 'transferOwnership',
        args: [safeAddress],
      }),
    );
    log.info('FloatUSTB.transferOwnership(safe) sent');
  }
  if ((await contracts.yieldReserve.read.owner()).toLowerCase() !== safeAddress.toLowerCase()) {
    await send(
      rt.deployment.yieldReserve,
      encodeFunctionData({
        abi: [{ type: 'function', name: 'transferOwnership', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] }] as const,
        functionName: 'transferOwnership',
        args: [safeAddress],
      }),
    );
    log.info('FloatYieldReserve.transferOwnership(safe) sent');
  }

  const grantRoleAbi = [
    { type: 'function', name: 'grantRole', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  ] as const;
  const renounceRoleAbi = [
    { type: 'function', name: 'renounceRole', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  ] as const;

  for (const [name, address, contract] of [
    ['FloatComplianceRegistry', rt.deployment.complianceRegistry, contracts.complianceRegistry] as const,
    ['FloatPolicyView', rt.deployment.policyView, contracts.policyView] as const,
  ]) {
    if (!(await contract.read.hasRole([adminRole, safeAddress]))) {
      await send(address, encodeFunctionData({ abi: grantRoleAbi, functionName: 'grantRole', args: [adminRole, safeAddress] }));
      log.info({ contract: name }, 'DEFAULT_ADMIN_ROLE granted to safe');
    }
  }

  // ── 3. the Safe accepts ownership on the two Ownable2Step contracts ─────
  const acceptOwnershipData = encodeFunctionData({
    abi: [{ type: 'function', name: 'acceptOwnership', stateMutability: 'nonpayable', inputs: [], outputs: [] }] as const,
    functionName: 'acceptOwnership',
  });
  for (const [name, address, contract] of [
    ['FloatUSTB', rt.deployment.floatUstb, contracts.floatUstb] as const,
    ['FloatYieldReserve', rt.deployment.yieldReserve, contracts.yieldReserve] as const,
  ]) {
    if ((await contract.read.owner()).toLowerCase() === safeAddress.toLowerCase()) {
      log.info({ contract: name }, 'already owned by safe — skipping acceptOwnership');
      continue;
    }
    const tx = await safe.createTransaction({ transactions: [{ to: address, value: '0', data: acceptOwnershipData }] });
    const signed = await safe.signTransaction(tx);
    const result = await safe.executeTransaction(signed);
    await rt.publicClient.waitForTransactionReceipt({ hash: result.hash as Hex });
    log.info({ contract: name, hash: result.hash }, 'safe accepted ownership');
  }

  // ── 4. deployer renounces its own DEFAULT_ADMIN_ROLE — a real handover ──
  for (const [name, address, contract] of [
    ['FloatComplianceRegistry', rt.deployment.complianceRegistry, contracts.complianceRegistry] as const,
    ['FloatPolicyView', rt.deployment.policyView, contracts.policyView] as const,
  ]) {
    if (await contract.read.hasRole([adminRole, deployer.address])) {
      await send(address, encodeFunctionData({ abi: renounceRoleAbi, functionName: 'renounceRole', args: [adminRole, deployer.address] }));
      log.info({ contract: name }, 'deployer renounced DEFAULT_ADMIN_ROLE');
    }
  }

  // ── 5. raise the threshold — from here, no single key can act alone ─────
  if ((await safe.getThreshold()) < 2) {
    const changeTx = await safe.createChangeThresholdTx(2);
    const signed = await safe.signTransaction(changeTx);
    const result = await safe.executeTransaction(signed);
    await rt.publicClient.waitForTransactionReceipt({ hash: result.hash as Hex });
    log.info({ hash: result.hash }, 'Safe threshold raised to 2-of-2');
  }

  // ── 6. verify ────────────────────────────────────────────────────────────
  const finalOwners = await safe.getOwners();
  const finalThreshold = await safe.getThreshold();
  const ustbOwner = await contracts.floatUstb.read.owner();
  const reserveOwner = await contracts.yieldReserve.read.owner();
  const registryAdminOnSafe = await contracts.complianceRegistry.read.hasRole([adminRole, safeAddress]);
  const registryAdminOnDeployer = await contracts.complianceRegistry.read.hasRole([adminRole, deployer.address]);
  const policyAdminOnSafe = await contracts.policyView.read.hasRole([adminRole, safeAddress]);
  const policyAdminOnDeployer = await contracts.policyView.read.hasRole([adminRole, deployer.address]);

  console.log('\n=== admin rotated to Safe multisig ===');
  console.log('Safe address:      ', safeAddress);
  console.log('Owners:            ', finalOwners);
  console.log('Threshold:         ', finalThreshold);
  console.log('FloatUSTB.owner:   ', ustbOwner, ustbOwner.toLowerCase() === safeAddress.toLowerCase() ? 'OK' : 'MISMATCH');
  console.log('YieldReserve.owner:', reserveOwner, reserveOwner.toLowerCase() === safeAddress.toLowerCase() ? 'OK' : 'MISMATCH');
  console.log('Registry admin: safe =', registryAdminOnSafe, ' deployer =', registryAdminOnDeployer, deployerCleared(registryAdminOnDeployer));
  console.log('PolicyView admin: safe =', policyAdminOnSafe, ' deployer =', policyAdminOnDeployer, deployerCleared(policyAdminOnDeployer));

  if (
    finalThreshold < 2 ||
    ustbOwner.toLowerCase() !== safeAddress.toLowerCase() ||
    reserveOwner.toLowerCase() !== safeAddress.toLowerCase() ||
    !registryAdminOnSafe ||
    registryAdminOnDeployer ||
    !policyAdminOnSafe ||
    policyAdminOnDeployer
  ) {
    throw new Error('rotation did not fully converge — see the printout above');
  }
  console.log('\nDone. The deployer key alone can no longer administer any Float contract.');
}

function deployerCleared(stillHasRole: boolean): string {
  return stillHasRole ? '(NOT CLEARED)' : '(cleared)';
}

main().catch((err: unknown) => {
  logger.error({ err }, 'rotate-admin-to-safe failed');
  process.exit(1);
});
