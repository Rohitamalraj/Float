/**
 * Adversarial verification of Layer 1 (the ZeroDev `toCallPolicy` session-key
 * scope). Given a provisioned business with an active agent session key, this
 * script has the agent signer attempt a battery of out-of-policy UserOperations
 * against the real bundler and asserts that every one is rejected at validation
 * — no transaction mined, no state touched.
 *
 *   pnpm --filter @float/agent-service attack:out-of-policy -- --business <id>
 *
 * Env: the standard agent-service config (RPC, ZERODEV_BUNDLER_RPC,
 * AGENT_SESSION_SIGNER_PRIVATE_KEY, DATABASE_URL). Requires ATTACK_CONFIRM=1.
 *
 * Exit code 0 iff every attack was cryptographically rejected AND the smart
 * account's USDC / FloatUSTB balances and ENS `float.*` records are unchanged.
 */
import { encodeFunctionData, getAddress, http, type Hex } from 'viem';
import { erc20Abi, floatComplianceRegistryAbi, floatSweepExecutorAbi } from '@float/contracts-sdk';
import { readFloatRecords } from '@float/ens';
import { agentGuard, restoreSessionKeyClient } from '@float/wallet';
import { requireEnv } from '@float/config';
import { logger } from '../logger.js';
import { getActiveSessionKey, getBusiness, listActiveBusinesses } from '../repo.js';
import { getRuntime, type AgentRuntime } from '../runtime.js';

const ATTACKER = getAddress('0x000000000000000000000000000000000000dEaD');

interface AttackVector {
  name: string;
  /** Why Layer 1 must refuse it. */
  rationale: string;
  calls: { to: Hex; data: Hex; value: bigint }[];
}

function buildVectors(rt: AgentRuntime, cap: bigint): AttackVector[] {
  const { sweepExecutor, usdc, floatUstb } = rt.deployment;
  const overCap = cap + 1n;
  const maxUint = (1n << 256n) - 1n;

  const sweepIn = (amount: bigint, value = 0n) => ({
    to: sweepExecutor,
    value,
    data: encodeFunctionData({
      abi: floatSweepExecutorAbi,
      functionName: 'sweepIn',
      args: [amount, 0n],
    }),
  });
  const approve = (token: Hex, spender: Hex, amount: bigint) => ({
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
  });

  return [
    {
      name: 'sweepIn over the per-tx cap',
      rationale: 'sweepIn arg0 must be ≤ maxSweepPerTx',
      calls: [sweepIn(overCap)],
    },
    {
      name: 'USDC.approve over the per-tx cap',
      rationale: 'USDC.approve arg1 must be ≤ maxSweepPerTx',
      calls: [approve(usdc, sweepExecutor, overCap)],
    },
    {
      name: 'unlimited USDC.approve to the executor',
      rationale: 'exact-amount approvals only; unlimited approvals disabled',
      calls: [approve(usdc, sweepExecutor, maxUint)],
    },
    {
      name: 'USDC.approve to an attacker address',
      rationale: 'USDC.approve spender must equal the executor',
      calls: [approve(usdc, ATTACKER, 1n)],
    },
    {
      name: 'FloatUSTB.approve to an attacker address',
      rationale: 'FloatUSTB.approve spender must equal the executor',
      calls: [approve(floatUstb, ATTACKER, 1n)],
    },
    {
      name: 'USDC.transfer (wrong selector on a permitted target)',
      rationale: 'only approve() is permitted on the token contracts',
      calls: [
        {
          to: usdc,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [ATTACKER, 1n],
          }),
        },
      ],
    },
    {
      name: 'call an unrelated Float contract (wrong target)',
      rationale: 'only the executor and the two tokens are permitted targets',
      calls: [
        {
          to: rt.deployment.complianceRegistry,
          value: 0n,
          data: encodeFunctionData({
            abi: floatComplianceRegistryAbi,
            functionName: 'revoke',
            args: [ATTACKER],
          }),
        },
      ],
    },
    {
      name: 'non-zero ETH value on an otherwise-valid sweepIn',
      rationale: 'every permitted call has valueLimit 0',
      calls: [sweepIn(1n, 1n)],
    },
    {
      name: 'valid approve leg followed by an out-of-policy approve',
      rationale: 'every call in a batch must independently satisfy the policy',
      calls: [approve(usdc, sweepExecutor, 1n), approve(usdc, ATTACKER, 1n)],
    },
  ];
}

async function main(): Promise<void> {
  const log = logger.child({ script: 'out-of-policy-attack' });
  if (process.env.ATTACK_CONFIRM !== '1') {
    throw new Error('refusing to run without ATTACK_CONFIRM=1');
  }

  const rt = getRuntime();
  const arg = process.argv.indexOf('--business');
  const businessId =
    arg !== -1 ? process.argv[arg + 1] : (await listActiveBusinesses(rt.db))[0]?.id;
  if (!businessId) throw new Error('no --business <id> given and no active business found');

  const business = await getBusiness(rt.db, businessId);
  if (!business?.smartAccountAddress) throw new Error(`business ${businessId} has no smart account`);
  const smartAccount = getAddress(business.smartAccountAddress);

  const sk = await getActiveSessionKey(rt.db, businessId);
  if (!sk) throw new Error(`business ${businessId} has no active session key`);
  const cap = BigInt(sk.policySnapshot.maxSweepPerTx);

  log.info({ businessId, smartAccount, cap: cap.toString() }, 'target acquired');

  // ── snapshot state ───────────────────────────────────────────────────────
  const balOf = async (token: Hex) =>
    rt.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [smartAccount],
    });
  const before = {
    usdc: await balOf(rt.deployment.usdc),
    ustb: await balOf(rt.deployment.floatUstb),
    ens: (business.ensResolver && business.ensNode
      ? await readFloatRecords(rt.publicClient, {
          resolver: getAddress(business.ensResolver),
          node: business.ensNode as Hex,
        })
      : {}),
  };

  const client = await restoreSessionKeyClient({
    publicClient: rt.publicClient,
    chain: rt.chain,
    serializedApproval: sk.serializedApproval,
    agentSigner: rt.signers.agentSession.account,
    bundlerTransport: http(requireEnv('ZERODEV_BUNDLER_RPC', 'attack script', rt.env)),
    runtime: rt.wallet,
  });

  const guard = agentGuard({ deployment: rt.deployment, maxSweepPerTx: cap });
  const vectors = buildVectors(rt, cap);
  const rows: { vector: string; guard: string; onchain: string; pass: boolean }[] = [];

  for (const v of vectors) {
    const local = guard.checkBatch(v.calls);
    const guardVerdict = local.ok ? 'ALLOWED (!)' : local.violation.code;

    let onchain: string;
    let pass: boolean;
    try {
      const hash = await client.sendUserOperation({ calls: v.calls });
      onchain = `ACCEPTED ${hash}`;
      pass = false; // the bundler should never accept this
    } catch (err) {
      onchain = `rejected: ${(err as Error).message.split('\n')[0]!.slice(0, 120)}`;
      pass = true;
    }
    rows.push({ vector: v.name, guard: guardVerdict, onchain, pass });
    log.info({ vector: v.name, rationale: v.rationale, guardVerdict, onchain, pass }, 'attack attempted');
  }

  // ── re-snapshot and diff ─────────────────────────────────────────────────
  const after = {
    usdc: await balOf(rt.deployment.usdc),
    ustb: await balOf(rt.deployment.floatUstb),
    ens: (business.ensResolver && business.ensNode
      ? await readFloatRecords(rt.publicClient, {
          resolver: getAddress(business.ensResolver),
          node: business.ensNode as Hex,
        })
      : {}),
  };
  const stateUnchanged =
    before.usdc === after.usdc &&
    before.ustb === after.ustb &&
    JSON.stringify(before.ens) === JSON.stringify(after.ens);

  // ── report ───────────────────────────────────────────────────────────────
  console.table(rows.map((r) => ({ vector: r.vector, guard: r.guard, onchain: r.onchain, pass: r.pass ? 'PASS' : 'FAIL' })));
  console.log(`\nstate unchanged: ${stateUnchanged ? 'PASS' : 'FAIL'}`);
  console.log(`  USDC   ${before.usdc} -> ${after.usdc}`);
  console.log(`  fUSTB  ${before.ustb} -> ${after.ustb}`);

  const allRejected = rows.every((r) => r.pass);
  if (!allRejected || !stateUnchanged) {
    console.error('\nLAYER 1 VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('\nLayer 1 verified: every out-of-policy UserOperation was rejected; no state changed.');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'attack script failed');
  process.exit(1);
});
