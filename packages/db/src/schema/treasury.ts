import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { hash32, pk, timestamps, tokenAmount } from './_common.js';
import { obligationRecurrence, obligationStatus, sweepDirection, sweepStatus } from './enums.js';
import { businesses } from './businesses.js';
import { users } from './identity.js';

/** A future outflow the agent must keep liquidity for (rent, payroll, invoices). */
export const obligations = pgTable(
  'obligations',
  {
    id: pk(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    amount: tokenAmount().notNull(),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    recurrence: obligationRecurrence().notNull().default('none'),
    status: obligationStatus().notNull().default('scheduled'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('obligations_business_due_idx').on(t.businessId, t.dueAt),
    index('obligations_status_idx').on(t.status),
  ],
);

/**
 * A single sweep the agent decided on and executed. `idempotencyKey` is
 * `<businessId>:<direction>:<decisionWindowStart>` — the executor worker refuses
 * to submit a second UserOp for the same key.
 */
export const sweeps = pgTable(
  'sweeps',
  {
    id: pk(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    direction: sweepDirection().notNull(),
    /** USDC base units (sweep_in: USDC spent; sweep_out: USDC targeted). */
    amount: tokenAmount().notNull(),
    minOut: tokenAmount().notNull(),
    decisionReason: text().notNull(),
    decisionDetail: jsonb().$type<Record<string, string | number | boolean>>(),
    idempotencyKey: text().notNull(),
    userOpHash: hash32(),
    txHash: hash32(),
    status: sweepStatus().notNull().default('pending'),
    gasUsed: tokenAmount(),
    error: text(),
    submittedAt: timestamp({ withTimezone: true }),
    confirmedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sweeps_idempotency_uq').on(t.idempotencyKey),
    index('sweeps_business_idx').on(t.businessId, t.createdAt),
    index('sweeps_status_idx').on(t.status),
  ],
);

/** Current yield-position snapshot for a business (one row), refreshed by the valuer. */
export const positions = pgTable('positions', {
  businessId: uuid()
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  /** FloatUSTB shares held, base units (9 dp). */
  yieldTokenBalance: tokenAmount().notNull().default('0'),
  /** USDC put in, base units. */
  costBasisUsdc: tokenAmount().notNull().default('0'),
  /** USDC-equivalent value at `lastValuedAt`. */
  valueUsdc: tokenAmount().notNull().default('0'),
  /** Realised yield to the business so far, USDC base units. */
  realizedYieldUsdc: tokenAmount().notNull().default('0'),
  /** Float's spread taken so far, USDC base units. */
  floatSpreadUsdc: tokenAmount().notNull().default('0'),
  lastValuedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export const obligationsRelations = relations(obligations, ({ one }) => ({
  business: one(businesses, { fields: [obligations.businessId], references: [businesses.id] }),
  creator: one(users, { fields: [obligations.createdBy], references: [users.id] }),
}));

export const sweepsRelations = relations(sweeps, ({ one }) => ({
  business: one(businesses, { fields: [sweeps.businessId], references: [businesses.id] }),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  business: one(businesses, { fields: [positions.businessId], references: [businesses.id] }),
}));
