import { numeric, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Column-builder helpers. Column names are derived from the table property key
 * via `casing: 'snake_case'` in `drizzle.config.ts` — so `agentKeyAddress`
 * becomes `agent_key_address`.
 */

/** UUID primary key with a DB-generated default. */
export const pk = () => uuid().primaryKey().defaultRandom();

/** `created_at` / `updated_at`, both timezone-aware, defaulting to now(). */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** 20-byte EVM address, `0x`-prefixed, stored lowercase by convention. */
export const evmAddress = () => varchar({ length: 42 });

/** 32-byte hash (tx hash, userop hash, ENS node), `0x`-prefixed. */
export const hash32 = () => varchar({ length: 66 });

/**
 * On-chain token amount in base units, as an exact decimal string.
 * USDC has 6 dp, FloatUSTB 9 dp — callers convert with viem `parseUnits` /
 * `formatUnits` and `BigInt`.
 */
export const tokenAmount = () => numeric({ precision: 78, scale: 0 });
