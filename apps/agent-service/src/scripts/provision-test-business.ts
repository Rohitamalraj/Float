/**
 * End-to-end provisioning of ONE real test business against the live Sepolia
 * deployment. This exercises the wiring apps/web's onboarding flow does not
 * yet perform on its own (ENS subname + resolver, Kernel v3 smart account,
 * agent session-key grant) — see docs/deployments.md for the gap this closes.
 *
 * Bootstraps identity (organization + user + business + compliance +
 * kyc_reviews) with the same shape apps/web's API would produce, does the
 * missing on-chain provisioning directly, then lets the *already-running*
 * agent-service (oracle-sync / policy-sync workers) pick up the compliance
 * attestation and policy mirror on their normal cadence — this is a genuine
 * test of the deployed pipeline, not a re-implementation of it.
 *
 * Requires: apps/agent-service running (this script assumes its oracle-sync
 * and policy-sync workers are ticking), ZERODEV_BUNDLER_RPC set,
 * ENS_PROVISIONER_PRIVATE_KEY, a funded DEPLOYER_PRIVATE_KEY (small ETH
 * transfer to the new business account), ADMIN_ALLOWLIST containing the
 * deployer address (to self-approve the KYC review).
 *
 *   PROVISION_CONFIRM=1 pnpm --filter @float/agent-service provision-test-business -- --label acme-test
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import {
  createWalletClient,
  getAddress,
  http,
  namehash,
  parseUnits,
  zeroAddress,
  type Hex,
  type LocalAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { businesses, compliance, kycReviews, organizations, sessionKeys, users } from '@float/db';
import { getSubregistry, planBusinessProvisioning } from '@float/ens';
import { getBusinessAccount, grantAgentSessionKey } from '@float/wallet';
import { logger } from '../logger.js';
import { getRuntime, type AgentRuntime } from '../runtime.js';

const BUFFER = parseUnits('2', 6);
const MAX_SWEEP = parseUnits('5', 6);
const FUND_ETH = parseUnits('0.01', 18);
/** The owner EOA only ever signs one ENS step + the session-key grant (off-chain). */
const OWNER_FUND_ETH = parseUnits('0.003', 18);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(label: string, timeoutMs: number, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(5_000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main(): Promise<void> {
  const log = logger.child({ script: 'provision-test-business' });
  if (process.env.PROVISION_CONFIRM !== '1') {
    throw new Error('refusing to run without PROVISION_CONFIRM=1');
  }

  const rt: AgentRuntime = getRuntime();
  if (!rt.ensDeployment) throw new Error('ENS v2 is not deployed/configured on this chain');
  if (!rt.wallet.bundlerRpc) throw new Error('ZERODEV_BUNDLER_RPC is not set');

  const resumeIdx = process.argv.indexOf('--resume');
  const resumeLabel = resumeIdx !== -1 ? process.argv[resumeIdx + 1] : undefined;
  const argIdx = process.argv.indexOf('--label');
  const label =
    resumeLabel ?? (argIdx !== -1 ? process.argv[argIdx + 1] : undefined) ?? `test-${Date.now()}`;
  const ensName = `${label}.${rt.env.ENS_PARENT_NAME}`;
  const secretsPath = `${process.env.USERPROFILE ?? process.env.HOME ?? '.'}/.float-deploy-secrets/business-${label}.json`;

  let owner: LocalAccount;
  let bizId: string;
  let smartAccount: Hex;

  if (resumeLabel) {
    // Pick up after a prior run that provisioned ENS + approved KYC but didn't
    // reach the session-key grant (e.g. the oracle/policy-sync wait timed out).
    const saved = JSON.parse(readFileSync(secretsPath, 'utf8')) as { ownerPrivateKey: Hex };
    owner = privateKeyToAccount(saved.ownerPrivateKey);
    const [existing] = await rt.db.select().from(businesses).where(eq(businesses.ensName, ensName));
    if (!existing?.smartAccountAddress) throw new Error(`no provisioned business found for ${ensName}`);
    bizId = existing.id;
    smartAccount = getAddress(existing.smartAccountAddress);
    log.info({ label, ensName, businessId: bizId, smartAccount }, 'resuming provisioning');
  } else {
    const ownerPrivateKey: Hex = `0x${randomBytes(32).toString('hex')}`;
    owner = privateKeyToAccount(ownerPrivateKey);
    writeFileSync(
      secretsPath,
      JSON.stringify({ label, ensName, ownerAddress: owner.address, ownerPrivateKey }, null, 2),
    );
    log.info({ label, ensName, owner: owner.address, secretsPath }, 'generated test owner key');

    // ── 1. identity + business rows (mirrors what apps/web's onboarding API produces) ──
    const [org] = await rt.db.insert(organizations).values({ name: `${label} (test)` }).returning();
    const [user] = await rt.db
      .insert(users)
      .values({ orgId: org!.id, address: owner.address.toLowerCase(), role: 'owner' })
      .returning();
    const [biz] = await rt.db
      .insert(businesses)
      .values({
        orgId: org!.id,
        ensName,
        ensNode: namehash(ensName),
        ownerKeyAddress: owner.address.toLowerCase(),
        chainId: rt.deployment.chainId,
        status: 'onboarding',
      })
      .returning();
    bizId = biz!.id;
    await rt.db.insert(compliance).values({
      businessId: bizId,
      kycStatus: 'pending',
      accreditation: 'non_accredited',
      source: 'manual_admin',
    });
    const [review] = await rt.db
      .insert(kycReviews)
      .values({ businessId: bizId, status: 'pending', documents: [] })
      .returning();
    log.info({ businessId: bizId, reviewId: review!.id }, 'business + compliance rows created');

    // ── 2. ENS: mint the subname, split policy/compliance record roles, set initial policy ──
    smartAccount = (await getBusinessAccount({ publicClient: rt.publicClient, ownerAccount: owner }))
      .address;
    const subregistry = await getSubregistry(rt.publicClient, rt.ensDeployment.registry, 'float');
    if (getAddress(subregistry) === zeroAddress) {
      throw new Error('float.eth has no subregistry — run register-ens-parent first');
    }

    const provisionerKey = process.env.ENS_PROVISIONER_PRIVATE_KEY as Hex | undefined;
    if (!provisionerKey) throw new Error('ENS_PROVISIONER_PRIVATE_KEY is not set');
    const provisioner = privateKeyToAccount(provisionerKey);

    const walletFor = (account: LocalAccount) =>
      createWalletClient({ account, chain: rt.chain, transport: http(rt.env.SEPOLIA_RPC_URL) });

    // Fund the owner EOA (signs one ENS step below) and the smart account (its own
    // gas — no ZeroDev paymaster configured) before broadcasting anything as either.
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY is not set');
    const deployer = privateKeyToAccount(deployerKey);
    const deployerClient = walletFor(deployer);
    for (const [to, value] of [
      [owner.address, OWNER_FUND_ETH],
      [smartAccount, FUND_ETH],
    ] as const) {
      const hash = await deployerClient.sendTransaction({ to, value });
      await rt.publicClient.waitForTransactionReceipt({ hash });
      log.info({ to, amount: value.toString(), hash }, 'funded with Sepolia ETH');
    }

    const plan = planBusinessProvisioning({
      deployment: rt.ensDeployment,
      ensName,
      parentRegistry: subregistry,
      smartAccount,
      provisioner: provisioner.address,
      ownerKey: owner.address,
      oracleKey: rt.signers.oracle.address,
      initialPolicy: {
        bufferAmount: BUFFER,
        maxSweepPerTx: MAX_SWEEP,
        allowedProtocol: rt.deployment.permissionsAdapter,
        targetYieldToken: rt.deployment.floatUstb,
      },
    });

    const provisionerClient = walletFor(provisioner);
    const ownerClient = walletFor(owner);

    for (const step of plan.steps) {
      const client = step.signer === 'owner' ? ownerClient : provisionerClient;
      log.info({ description: step.description, signer: step.signer }, 'broadcasting ENS step');
      for (const call of step.calls) {
        const hash = await client.sendTransaction({ to: call.to, data: call.data, value: call.value });
        const receipt = await rt.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error(`ENS step failed: ${step.description} (${hash})`);
      }
    }
    log.info({ resolver: plan.resolver, smartAccount }, 'ENS provisioning complete');

    await rt.db
      .update(businesses)
      .set({ smartAccountAddress: smartAccount.toLowerCase(), ensResolver: plan.resolver, updatedAt: new Date() })
      .where(eq(businesses.id, bizId));

    // ── 3. approve KYC (self-service admin, deployer is in ADMIN_ALLOWLIST) — mirrors
    //      apps/web's POST /api/admin/kyc-reviews approve path exactly ──
    await rt.db
      .update(kycReviews)
      .set({ status: 'approved', reviewedBy: user!.id, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(kycReviews.id, review!.id));
    await rt.db
      .update(compliance)
      .set({ kycStatus: 'pending', updatedAt: new Date() })
      .where(eq(compliance.businessId, bizId));
    await rt.db
      .update(businesses)
      .set({ status: 'active', activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(businesses.id, bizId));
    log.info('KYC review approved — waiting for the running agent-service to sync');
  }

  // ── 4. wait for the live oracle-sync + policy-sync workers ──
  await pollUntil('on-chain compliance attestation (oracle-sync, ~30s cadence)', 180_000, async () => {
    const isVerified = await rt.publicClient.readContract({
      address: rt.deployment.complianceRegistry,
      abi: [
        {
          type: 'function',
          name: 'isVerified',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ type: 'bool' }],
        },
      ] as const,
      functionName: 'isVerified',
      args: [smartAccount],
    });
    return isVerified;
  });
  log.info('on-chain compliance attestation confirmed');

  await pollUntil('FloatPolicyView mirror (policy-sync, ~60s cadence)', 180_000, async () => {
    const p = await rt.publicClient.readContract({
      address: rt.deployment.policyView,
      abi: [
        {
          type: 'function',
          name: 'policyOf',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [
            {
              type: 'tuple',
              components: [
                { name: 'set', type: 'bool' },
                { name: 'bufferAmount', type: 'uint128' },
                { name: 'maxSweepPerTx', type: 'uint128' },
              ],
            },
          ],
        },
      ] as const,
      functionName: 'policyOf',
      args: [smartAccount],
    });
    return p.set;
  });
  log.info('FloatPolicyView mirror confirmed');

  // ── 5. grant the scoped agent session key ──
  const granted = await grantAgentSessionKey({
    publicClient: rt.publicClient,
    ownerAccount: owner,
    agentSignerAddress: rt.signers.agentSession.address,
    deployment: rt.deployment,
    maxSweepPerTx: MAX_SWEEP,
    runtime: rt.wallet,
  });

  await rt.db.insert(sessionKeys).values({
    businessId: bizId,
    agentKeyAddress: rt.signers.agentSession.address,
    serializedApproval: granted.serializedApproval,
    policySnapshot: {
      maxSweepPerTx: granted.policySnapshot.maxSweepPerTx,
      executor: granted.policySnapshot.executor,
      usdc: granted.policySnapshot.usdc,
      allowedTargets: [granted.policySnapshot.executor, granted.policySnapshot.usdc, granted.policySnapshot.floatUstb],
      kernelVersion: rt.env.KERNEL_VERSION,
      entryPoint: rt.env.ENTRYPOINT_ADDRESS,
    },
    status: 'active',
    grantedAt: new Date(),
  });

  console.log('\n=== test business provisioned ===');
  console.log('businessId:  ', bizId);
  console.log('ensName:     ', ensName);
  console.log('smartAccount:', smartAccount);
  console.log('owner key saved to:', secretsPath);
  console.log(
    `\nNext: ATTACK_CONFIRM=1 pnpm --filter @float/agent-service attack:out-of-policy -- --business ${bizId}`,
  );
}

main().catch((err: unknown) => {
  logger.error({ err }, 'provision-test-business failed');
  process.exit(1);
});
