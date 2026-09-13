/**
 * One-time: attach a subregistry to Float's ENS v2 parent name so business
 * subnames can be minted under it. Run once, after the parent name itself has
 * been registered via `contracts/script/RegisterEnsParent.s.sol` (commit-reveal
 * against the real ETHRegistrar, paid in USDC — see that script's header).
 *
 *   ENS_PARENT_TOKEN_ID=<tokenId from RegisterEnsParent's register() output> \
 *     pnpm --filter @float/agent-service register-ens-parent
 *
 * Required env: ENS_PROVISIONER_PRIVATE_KEY, ENS_PARENT_TOKEN_ID (decimal or
 * 0x-hex — the exact value RegisterEnsParent.s.sol's `register()` logged).
 */
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requireEnv } from '@float/config';
import { planParentSubregistry } from '@float/ens';
import { logger } from '../logger.js';
import { getRuntime } from '../runtime.js';

async function main(): Promise<void> {
  const log = logger.child({ script: 'register-ens-parent' });
  const rt = getRuntime();
  if (!rt.ensDeployment) throw new Error('ENS v2 is not deployed/configured on this chain');

  const provisionerKey = requireEnv(
    'ENS_PROVISIONER_PRIVATE_KEY',
    'sign the subregistry-attach transactions',
    rt.env,
  ) as Hex;
  const provisioner = privateKeyToAccount(provisionerKey);

  const raw = process.env.ENS_PARENT_TOKEN_ID;
  if (!raw) throw new Error('ENS_PARENT_TOKEN_ID is not set');
  const parentTokenId = BigInt(raw); // BigInt() accepts both decimal and 0x-hex strings

  const parentName = rt.env.ENS_PARENT_NAME;
  const plan = planParentSubregistry({
    deployment: rt.ensDeployment,
    parentName,
    parentTokenId,
    provisioner: provisioner.address,
  });

  log.info(
    { parentName, parentTokenId: parentTokenId.toString(), subregistry: plan.subregistry },
    'plan built',
  );

  const client = createWalletClient({
    account: provisioner,
    chain: rt.chain,
    transport: http(rt.env.SEPOLIA_RPC_URL),
  });

  for (const step of plan.steps) {
    log.info({ description: step.description }, 'broadcasting step');
    for (const call of step.calls) {
      const hash = await client.sendTransaction({ to: call.to, data: call.data, value: call.value });
      const receipt = await rt.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`step failed: ${step.description} (${hash})`);
      log.info({ hash }, 'confirmed');
    }
  }

  console.log(`\n${parentName} now has a subregistry at ${plan.subregistry}.`);
  console.log('Business onboarding (planBusinessProvisioning) can mint subnames under it.');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'register-ens-parent failed');
  process.exit(1);
});
