import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { ChainKey } from './chains.js';

/** Walk up from `start` until a directory containing `pnpm-workspace.yaml` is found. */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

let dotenvLoaded = false;
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const explicit = process.env.DOTENV_PATH;
  if (explicit) {
    loadDotenv({ path: explicit });
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(process.cwd()) ?? findRepoRoot(here);
  if (root) loadDotenv({ path: resolve(root, '.env') });
  else loadDotenv();
}

const hexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte 0x-prefixed hex private key')
  .optional();

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte 0x-prefixed address')
  .optional();

const url = z.string().url().optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  FLOAT_CHAIN: z.enum(['mainnet', 'sepolia', 'anvil']).default('sepolia'),

  // RPC / explorer
  SEPOLIA_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  MAINNET_RPC_URL: z.string().url().default('https://ethereum-rpc.publicnode.com'),
  ANVIL_RPC_URL: z.string().url().default('http://127.0.0.1:8545'),
  ETHERSCAN_API_KEY: z.string().optional(),

  // datastores
  DATABASE_URL: z.string().url().default('postgres://float:float@localhost:5432/float'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // keys
  DEPLOYER_PRIVATE_KEY: hexKey,
  COMPLIANCE_ORACLE_PRIVATE_KEY: hexKey,
  POLICY_SYNC_PRIVATE_KEY: hexKey,
  ENS_PROVISIONER_PRIVATE_KEY: hexKey,
  AGENT_SESSION_SIGNER_PRIVATE_KEY: hexKey,

  // protocol roles / addresses
  FLOAT_ADMIN_ADDRESS: address,
  FLOAT_TREASURY_ADDRESS: address,

  // deployed contracts
  FLOAT_COMPLIANCE_REGISTRY_ADDRESS: address,
  FLOAT_ALLOWLIST_CHECKER_ADDRESS: address,
  FLOAT_SWEEP_EXECUTOR_ADDRESS: address,
  FLOAT_POLICY_VIEW_ADDRESS: address,
  FLOAT_USTB_ADDRESS: address,
  FLOAT_YIELD_RESERVE_ADDRESS: address,
  FLOAT_PERMISSIONS_ADAPTER_ADDRESS: address,
  FLOAT_POOL_ID: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  USDC_ADDRESS: address,

  // ENS v2
  ENS_PARENT_NAME: z.string().default('float.eth'),
  ENS_REGISTRY_ADDRESS: address,
  ENS_PERMISSIONED_RESOLVER_IMPL_ADDRESS: address,

  // ERC-4337 / ZeroDev
  ZERODEV_PROJECT_ID: z.string().optional(),
  ZERODEV_BUNDLER_RPC: url,
  ZERODEV_PAYMASTER_RPC: url,
  /** Kernel account version. EntryPoint is fixed at v0.7. */
  KERNEL_VERSION: z.enum(['0.3.1', '0.3.2', '0.3.3']).default('0.3.3'),
  ENTRYPOINT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000071727De22E5E9d8BAf0edAc6f37da032'),

  // gateway
  GATEWAY_PORT: z.coerce.number().int().positive().default(8402),
  X402_ENABLED: z
    .string()
    .default('true')
    .transform((s) => s !== 'false' && s !== '0'),
  /** enforce = reject unpaid calls; permissive = log + allow (dev / behind a hosted gateway). */
  X402_MODE: z.enum(['enforce', 'permissive']).default('enforce'),
  X402_NETWORK: z.string().default('base-sepolia'),
  X402_RECEIVING_ADDRESS: address,
  X402_PRICE_USDC: z.coerce.number().positive().default(0.01),
  X402_FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator'),

  // web
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  SIWE_DOMAIN: z.string().default('localhost:3000'),
  ADMIN_ALLOWLIST: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),

  // notifications
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Float <noreply@float.example>'),

  // agent service
  AGENT_SERVICE_PORT: z.coerce.number().int().positive().default(8080),
  SWEEP_OUT_LOOKAHEAD_HOURS: z.coerce.number().positive().default(48),
  WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  /** Re-evaluate every managed business on this cadence (safety net for missed events). */
  EVALUATE_INTERVAL_MS: z.coerce.number().int().positive().default(300000),
  /** Slippage bound applied to quotes when building a sweep, basis points. */
  SWEEP_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(50),
  /** Skip sweeps smaller than this, USDC (decimal string). */
  MIN_SWEEP_USDC: z.string().default('25'),
  /** Refuse to trade on a compliance attestation older than this many hours. */
  MAX_COMPLIANCE_AGE_HOURS: z.coerce.number().positive().default(720),
  EXECUTE_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type FloatEnv = z.infer<typeof EnvSchema>;

let cached: FloatEnv | undefined;

export function loadEnv(): FloatEnv {
  if (cached) return cached;
  ensureDotenv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Float environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper — forces a re-parse on next `loadEnv()`. */
export function resetEnvCache(): void {
  cached = undefined;
  dotenvLoaded = false;
}

export function activeChainKey(): ChainKey {
  return loadEnv().FLOAT_CHAIN;
}

export function rpcUrlFor(chain: ChainKey, env: FloatEnv = loadEnv()): string {
  switch (chain) {
    case 'mainnet':
      return env.MAINNET_RPC_URL;
    case 'sepolia':
      return env.SEPOLIA_RPC_URL;
    case 'anvil':
      return env.ANVIL_RPC_URL;
  }
}

export class MissingConfigError extends Error {
  constructor(varName: string, purpose: string) {
    super(`Missing required env var ${varName} — needed to ${purpose}`);
    this.name = 'MissingConfigError';
  }
}

export function requireEnv<K extends keyof FloatEnv>(
  key: K,
  purpose: string,
  env: FloatEnv = loadEnv(),
): NonNullable<FloatEnv[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === '') {
    throw new MissingConfigError(String(key), purpose);
  }
  return value;
}
