import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import {
  activeChainKey,
  loadEnv,
  requireEnv,
  rpcUrlFor,
  viemChainFor,
  type ChainKey,
  type FloatEnv,
} from '@float/config';
import { resolveFloatDeployment, type FloatDeployment } from '@float/contracts-sdk';
import { getDb, type Database } from '@float/db';
import { EnsNotDeployedError, resolveEnsDeployment, type EnsDeployment } from '@float/ens';
import { resolveFloatVenue, type FloatVenue } from '@float/uniswap';
import { walletRuntimeConfig, type WalletRuntimeConfig } from '@float/wallet';
import { logger } from './logger.js';
import { envSigner, type FloatSigner } from './signers.js';

export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

export interface AgentParams {
  sweepOutLookaheadMs: number;
  evaluateIntervalMs: number;
  watcherPollIntervalMs: number;
  slippageBps: number;
  /** USDC base units. */
  minSweepUsdc: bigint;
  maxComplianceAgeMs: number;
  executeConcurrency: number;
}

export interface AgentRuntime {
  env: FloatEnv;
  chainKey: ChainKey;
  chain: Chain;
  publicClient: PublicClient;
  db: Database;
  redis: RedisConnection;
  deployment: FloatDeployment;
  ensDeployment?: EnsDeployment;
  venue: FloatVenue;
  wallet: WalletRuntimeConfig;
  signers: { oracle: FloatSigner; policySync: FloatSigner; agentSession: FloatSigner };
  walletClients: { oracle: WalletClient; policySync: WalletClient };
  params: AgentParams;
}

function parseRedisUrl(url: string): RedisConnection {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
  };
}

let cached: AgentRuntime | undefined;

export function getRuntime(): AgentRuntime {
  if (cached) return cached;

  const env = loadEnv();
  const chainKey = activeChainKey();
  const chain = viemChainFor(chainKey);
  const transport = http(rpcUrlFor(chainKey, env));
  const publicClient = createPublicClient({ chain, transport });

  const deployment = resolveFloatDeployment({ chainKey, env });

  let ensDeployment: EnsDeployment | undefined;
  try {
    ensDeployment = resolveEnsDeployment(chainKey);
  } catch (err) {
    if (!(err instanceof EnsNotDeployedError)) throw err;
    logger.warn({ chainKey }, 'ENS v2 not deployed on this chain — ENS record mirroring disabled');
  }

  const key = (name: Parameters<typeof requireEnv>[0], why: string): Hex =>
    requireEnv(name, why, env) as Hex;
  const signers = {
    oracle: envSigner(
      'oracle',
      key('COMPLIANCE_ORACLE_PRIVATE_KEY', 'write compliance attestations'),
    ),
    policySync: envSigner('policy-sync', key('POLICY_SYNC_PRIVATE_KEY', 'sync FloatPolicyView')),
    agentSession: envSigner(
      'agent-session',
      key('AGENT_SESSION_SIGNER_PRIVATE_KEY', 'sign sweep UserOperations'),
    ),
  };

  const walletClients = {
    oracle: createWalletClient({ account: signers.oracle.account, chain, transport }),
    policySync: createWalletClient({ account: signers.policySync.account, chain, transport }),
  };

  cached = {
    env,
    chainKey,
    chain,
    publicClient,
    db: getDb(),
    redis: parseRedisUrl(env.REDIS_URL),
    deployment,
    ensDeployment,
    venue: resolveFloatVenue({ chainKey }),
    wallet: walletRuntimeConfig(env),
    signers,
    walletClients,
    params: {
      sweepOutLookaheadMs: env.SWEEP_OUT_LOOKAHEAD_HOURS * 3600_000,
      evaluateIntervalMs: env.EVALUATE_INTERVAL_MS,
      watcherPollIntervalMs: env.WATCHER_POLL_INTERVAL_MS,
      slippageBps: env.SWEEP_SLIPPAGE_BPS,
      minSweepUsdc: parseUnits(env.MIN_SWEEP_USDC, 6),
      maxComplianceAgeMs: env.MAX_COMPLIANCE_AGE_HOURS * 3600_000,
      executeConcurrency: env.EXECUTE_CONCURRENCY,
    },
  };
  return cached;
}
