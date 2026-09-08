import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { evmAddress, hash32, pk, timestamps, tokenAmount } from './_common.js';
import { businessStatus, sessionKeyStatus } from './enums.js';
import { organizations } from './identity.js';

export interface SessionKeyPolicySnapshot {
  maxSweepPerTx: string;
  executor: string;
  usdc: string;
  allowedTargets: string[];
  kernelVersion: string;
  entryPoint: string;
}

/**
 * A business's Float account: its ENS name, its ERC-4337 smart account, and the
 * owner key that controls it. Float never holds the owner key.
 */
export const businesses = pgTable(
  'businesses',
  {
    id: pk(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** e.g. `rosa-design.float.eth` */
    ensName: text().notNull(),
    /** namehash of `ensName`, `0x`-prefixed. */
    ensNode: hash32(),
    smartAccountAddress: evmAddress(),
    ownerKeyAddress: evmAddress().notNull(),
    chainId: integer().notNull(),
    status: businessStatus().notNull().default('onboarding'),
    /** Latest known working-capital buffer, USDC base units (mirror of ENS record). */
    bufferAmount: tokenAmount(),
    activatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('businesses_ens_name_uq').on(t.ensName),
    uniqueIndex('businesses_smart_account_uq').on(t.smartAccountAddress),
    index('businesses_org_idx').on(t.orgId),
    index('businesses_status_idx').on(t.status),
  ],
);

/**
 * A granted agent session key (ZeroDev permission validator). `serializedApproval`
 * is the owner-signed blob the agent service reconstructs the scoped account from.
 */
export const sessionKeys = pgTable(
  'session_keys',
  {
    id: pk(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    agentKeyAddress: evmAddress().notNull(),
    serializedApproval: text().notNull(),
    /** { maxSweepPerTx, executor, usdc, allowedTargets[] } captured at grant time. */
    policySnapshot: jsonb().$type<SessionKeyPolicySnapshot>().notNull(),
    status: sessionKeyStatus().notNull().default('pending'),
    grantedTxHash: hash32(),
    grantedAt: timestamp({ withTimezone: true }),
    revokedTxHash: hash32(),
    revokedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('session_keys_business_idx').on(t.businessId),
    // At most one non-terminal (pending|active) session key per business.
    uniqueIndex('session_keys_active_uq')
      .on(t.businessId)
      .where(sql`status in ('pending', 'active')`),
  ],
);

/**
 * On-chain mirror of the Layer 2 policy (ENS records + FloatPolicyView). One row
 * per business; kept in sync by the agent service's policy-sync worker.
 */
export const policies = pgTable('policies', {
  businessId: uuid()
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  bufferAmount: tokenAmount().notNull(),
  maxSweepPerTx: tokenAmount().notNull(),
  allowedProtocol: evmAddress().notNull(),
  targetYieldToken: evmAddress().notNull(),
  ensSyncedAt: timestamp({ withTimezone: true }),
  policyViewSyncedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  org: one(organizations, { fields: [businesses.orgId], references: [organizations.id] }),
  sessionKeys: many(sessionKeys),
  policy: one(policies, { fields: [businesses.id], references: [policies.businessId] }),
}));

export const sessionKeysRelations = relations(sessionKeys, ({ one }) => ({
  business: one(businesses, { fields: [sessionKeys.businessId], references: [businesses.id] }),
}));

export const policiesRelations = relations(policies, ({ one }) => ({
  business: one(businesses, { fields: [policies.businessId], references: [businesses.id] }),
}));
