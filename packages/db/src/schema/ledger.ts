import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { evmAddress, hash32, pk, timestamps, tokenAmount } from './_common.js';
import { auditActorType, onchainTxKind, onchainTxStatus, signerRole } from './enums.js';
import { businesses } from './businesses.js';

/** Every state-changing transaction one of Float's operational keys submits. */
export const onchainTx = pgTable(
  'onchain_tx',
  {
    id: pk(),
    businessId: uuid().references(() => businesses.id, { onDelete: 'set null' }),
    kind: onchainTxKind().notNull(),
    signerRole: signerRole().notNull(),
    chainId: integer().notNull(),
    txHash: hash32(),
    status: onchainTxStatus().notNull().default('pending'),
    payload: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    confirmedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('onchain_tx_hash_uq').on(t.txHash),
    index('onchain_tx_business_idx').on(t.businessId, t.createdAt),
    index('onchain_tx_kind_idx').on(t.kind),
  ],
);

/** Metered calls to the Bazantic gateway (revenue line 2 accounting). */
export const gatewayCalls = pgTable(
  'gateway_calls',
  {
    id: pk(),
    callerAddress: evmAddress(),
    endpoint: text().notNull(),
    ensName: text(),
    request: jsonb().$type<Record<string, unknown>>(),
    responseSummary: jsonb().$type<Record<string, unknown>>(),
    allowed: boolean(),
    /** USDC charged, base units. */
    paidAmount: tokenAmount(),
    x402TxHash: hash32(),
    statusCode: smallint().notNull(),
    latencyMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gateway_calls_created_idx').on(t.createdAt),
    index('gateway_calls_caller_idx').on(t.callerAddress),
  ],
);

/** Append-only audit trail. Never updated or deleted. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    actorType: auditActorType().notNull(),
    actorId: text().notNull(),
    businessId: uuid().references(() => businesses.id, { onDelete: 'set null' }),
    action: text().notNull(),
    target: text(),
    before: jsonb(),
    after: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_business_idx').on(t.businessId, t.createdAt),
    index('audit_log_action_idx').on(t.action),
  ],
);

/** Chain-scan checkpoints for the balance watcher (e.g. id `usdc-transfers:sepolia`). */
export const watcherCursors = pgTable('watcher_cursors', {
  id: text().primaryKey(),
  lastBlock: bigint({ mode: 'bigint' }).notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const onchainTxRelations = relations(onchainTx, ({ one }) => ({
  business: one(businesses, { fields: [onchainTx.businessId], references: [businesses.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  business: one(businesses, { fields: [auditLog.businessId], references: [businesses.id] }),
}));
