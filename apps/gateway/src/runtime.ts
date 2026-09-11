import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import {
  activeChainKey,
  loadEnv,
  rpcUrlFor,
  viemChainFor,
  type ChainKey,
  type FloatEnv,
} from '@float/config';
import { resolveFloatDeployment, type FloatDeployment } from '@float/contracts-sdk';
import { getDb, type Database } from '@float/db';
import { EnsNotDeployedError, resolveEnsDeployment, type EnsDeployment } from '@float/ens';
import { logger } from './logger.js';

export interface X402Config {
  enabled: boolean;
  mode: 'enforce' | 'permissive';
  network: string;
  payTo?: `0x${string}`;
  priceUsdc: number;
  facilitatorUrl: string;
  /** USDC contract on the x402 payment network. */
  asset: `0x${string}`;
}

export interface GatewayRuntime {
  env: FloatEnv;
  chainKey: ChainKey;
  chain: Chain;
  publicClient: PublicClient;
  db: Database;
  deployment: FloatDeployment;
  ensDeployment?: EnsDeployment;
  x402: X402Config;
  maxComplianceAgeMs: number;
  port: number;
  rateLimitPerMinute: number;
}

let cached: GatewayRuntime | undefined;

export function getRuntime(): GatewayRuntime {
  if (cached) return cached;
  const env = loadEnv();
  const chainKey = activeChainKey();
  const chain = viemChainFor(chainKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrlFor(chainKey, env)) });

  const deployment = resolveFloatDeployment({ chainKey, env });

  let ensDeployment: EnsDeployment | undefined;
  try {
    ensDeployment = resolveEnsDeployment(chainKey);
  } catch (err) {
    if (!(err instanceof EnsNotDeployedError)) throw err;
    logger.warn({ chainKey }, 'ENS v2 not deployed — on-chain name resolution disabled');
  }

  cached = {
    env,
    chainKey,
    chain,
    publicClient,
    db: getDb(),
    deployment,
    ensDeployment,
    x402: {
      enabled: env.X402_ENABLED,
      mode: env.X402_MODE,
      network: env.X402_NETWORK,
      payTo: env.X402_RECEIVING_ADDRESS as `0x${string}` | undefined,
      priceUsdc: env.X402_PRICE_USDC,
      facilitatorUrl: env.X402_FACILITATOR_URL,
      asset: deployment.usdc,
    },
    maxComplianceAgeMs: env.MAX_COMPLIANCE_AGE_HOURS * 3600_000,
    port: env.GATEWAY_PORT,
    rateLimitPerMinute: env.GATEWAY_RATE_LIMIT_PER_MINUTE,
  };
  return cached;
}
