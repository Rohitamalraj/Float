/**
 * End-to-end integration harness: drives one business through the full
 * lifecycle against live Sepolia contracts and a running agent-service —
 * payment-in → sweep-in → obligation → sweep-out → fee-collect — and reports
 * the on-chain deltas (FloatUSTB share price, Float treasury spread).
 *
 * This is an *operational* script, not a unit test: it requires
 *   1. a provisioned business (ENS name, smart account, active session key,
 *      status 'active') — see the onboarding flow / `docs/runbook.md`,
 *   2. `apps/agent-service`'s workers already running against the same
 *      Redis + Postgres + chain (`pnpm --filter @float/agent-service start`),
 *   3. a funder key holding enough Sepolia test USDC.
 *
 * It only enqueues work and observes the database + chain — it never signs a
 * session-key UserOperation itself, so it's a genuine test of the deployed
 * pipeline rather than a re-implementation of it.
 *
 *   HARNESS_CONFIRM=1 pnpm --filter @float/agent-service harness -- --business <id>
 */
import { desc, eq } from 'drizzle-orm';
import { getAddress, http, parseUnits, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { erc20Abi, floatContracts } from '@float/contracts-sdk';
import { obligations, sweeps } from '@float/db';
import { requireEnv } from '@float/config';
import { logger } from '../logger.js';
import { QUEUE, connectionFor, makeQueue, type EvaluateJob } from '../queues.js';
import { getBusiness, getPolicyMirror, listActiveBusinesses } from '../repo.js';
import { getRuntime } from '../runtime.js';

const FUND_DEFAULT = parseUnits('600', 6);
const OBLIGATION_DEFAULT = parseUnits('100', 6);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSweep(
  rt: ReturnType<typeof getRuntime>,
  businessId: string,
  direction: 'in' | 'out',
  since: Date,
  timeoutMs: number,
  pollMs: number,
): Promise<{ id: string; status: string; txHash: string | null } | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await rt.db
      .select()
      .from(sweeps)
      .where(eq(sweeps.businessId, businessId))
      .orderBy(desc(sweeps.createdAt))
      .limit(10);
    const hit = rows.find(
      (s) => s.direction === direction && s.createdAt >= since && s.status !== 'pending',
    );
    if (hit) return hit;
    await sleep(pollMs);
  }
  return undefined;
}

async function main(): Promise<void> {
  const log = logger.child({ script: 'integration-harness' });
  if (process.env.HARNESS_CONFIRM !== '1') {
    throw new Error('refusing to run without HARNESS_CONFIRM=1');
  }

  const rt = getRuntime();
  const pollMs = Number(process.env.HARNESS_POLL_INTERVAL_MS ?? 5_000);
  const timeoutMs = Number(process.env.HARNESS_TIMEOUT_MS ?? 300_000);

  const arg = process.argv.indexOf('--business');
  const businessId =
    arg !== -1 ? process.argv[arg + 1] : (await listActiveBusinesses(rt.db))[0]?.id;
  if (!businessId) throw new Error('no --business <id> given and no active business found');

  const business = await getBusiness(rt.db, businessId);
  if (!business?.smartAccountAddress) throw new Error(`business ${businessId} has no smart account`);
  const smartAccount = getAddress(business.smartAccountAddress);
  const policy = await getPolicyMirror(rt.db, businessId);
  const buffer = policy ? BigInt(policy.bufferAmount) : parseUnits('2000', 6);

  log.info({ businessId, smartAccount, buffer: buffer.toString() }, 'harness target');

  const funderKey = (process.env.HARNESS_FUNDER_PRIVATE_KEY ??
    requireEnv('DEPLOYER_PRIVATE_KEY', 'fund the business account for the harness', rt.env)) as Hex;
  const funder = privateKeyToAccount(funderKey);
  const { createWalletClient } = await import('viem');
  const funderClient = createWalletClient({ account: funder, chain: rt.chain, transport: http() });

  const contracts = floatContracts(rt.deployment, { public: rt.publicClient });
  const treasury = await contracts.floatUstb.read.TREASURY();
  const ONE_SHARE = 10n ** 9n; // 6-dp asset + 3-dp offset

  const snapshot = async () => ({
    usdc: await rt.publicClient.readContract({
      address: rt.deployment.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [smartAccount],
    }),
    floatUstbBalance: await rt.publicClient.readContract({
      address: rt.deployment.floatUstb,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [smartAccount],
    }),
    /** Assets redeemable per whole share — the accrual-growth signal. */
    sharePrice: await contracts.floatUstb.read.convertToAssets([ONE_SHARE]),
    treasuryUsdc: await rt.publicClient.readContract({
      address: rt.deployment.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [treasury],
    }),
  });

  const evaluateQueue = makeQueue<EvaluateJob>(QUEUE.evaluate, connectionFor(rt.redis));

  // ── 1. payment-in: fund the business account above its buffer ──────────
  const before = await snapshot();
  log.info({ before: stringify(before) }, 'pre-sweep-in state');

  const fundAmount = process.env.HARNESS_FUND_USDC
    ? BigInt(process.env.HARNESS_FUND_USDC)
    : buffer + FUND_DEFAULT;
  const fundTx = await funderClient.writeContract({
    address: rt.deployment.usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [smartAccount, fundAmount],
  });
  await rt.publicClient.waitForTransactionReceipt({ hash: fundTx });
  log.info({ fundTx, fundAmount: fundAmount.toString() }, 'funded business account');

  // ── 2. observe sweep-in ──────────────────────────────────────────────────
  const t0 = new Date();
  await evaluateQueue.add('evaluate', { businessId, reason: 'harness:fund' });
  const sweepIn = await waitForSweep(rt, businessId, 'in', t0, timeoutMs, pollMs);
  if (!sweepIn) throw new Error('timed out waiting for sweep-in — is the agent-service running?');
  if (sweepIn.status !== 'confirmed') throw new Error(`sweep-in ended as ${sweepIn.status}`);
  log.info({ sweepIn }, 'sweep-in confirmed');

  const afterIn = await snapshot();
  log.info({ afterIn: stringify(afterIn) }, 'post-sweep-in state');

  // ── 3. add a near-due obligation ─────────────────────────────────────────
  const obligationAmount = process.env.HARNESS_OBLIGATION_USDC
    ? BigInt(process.env.HARNESS_OBLIGATION_USDC)
    : OBLIGATION_DEFAULT;
  const dueAt = new Date(Date.now() + Math.max(rt.params.sweepOutLookaheadMs - 60_000, 60_000));
  await rt.db.insert(obligations).values({
    businessId,
    label: 'integration-harness',
    amount: obligationAmount.toString(),
    dueAt,
    status: 'scheduled',
  });
  log.info({ obligationAmount: obligationAmount.toString(), dueAt }, 'obligation inserted');

  // ── 4. observe sweep-out ─────────────────────────────────────────────────
  const t1 = new Date();
  await evaluateQueue.add('evaluate', { businessId, reason: 'harness:obligation' });
  const sweepOut = await waitForSweep(rt, businessId, 'out', t1, timeoutMs, pollMs);
  if (!sweepOut) throw new Error('timed out waiting for sweep-out');
  if (sweepOut.status !== 'confirmed') throw new Error(`sweep-out ended as ${sweepOut.status}`);
  log.info({ sweepOut }, 'sweep-out confirmed');

  // ── 5. report deltas (share price / treasury spread — fee-collect happens
  //      inline on any vault interaction, so the sweep-out redeem already
  //      triggered it) ────────────────────────────────────────────────────
  const after = await snapshot();
  log.info({ after: stringify(after) }, 'final state');

  console.log('\n=== integration harness summary ===');
  console.log('sweep-in  tx:', sweepIn.txHash);
  console.log('sweep-out tx:', sweepOut.txHash);
  console.log(
    'FloatUSTB share price (assets per whole share):',
    before.sharePrice.toString(),
    '->',
    after.sharePrice.toString(),
  );
  console.log(
    'Float treasury USDC balance:',
    before.treasuryUsdc.toString(),
    '->',
    after.treasuryUsdc.toString(),
    `(Δ ${(after.treasuryUsdc - before.treasuryUsdc).toString()})`,
  );
  if (after.treasuryUsdc < before.treasuryUsdc) {
    throw new Error('treasury balance decreased — spread accounting regression');
  }
  console.log('\nLifecycle verified: payment-in -> sweep-in -> obligation -> sweep-out, all confirmed on-chain.');

  await evaluateQueue.close();
}

function stringify(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, val: unknown) => (typeof val === 'bigint' ? val.toString() : val)));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'integration harness failed');
  process.exit(1);
});
