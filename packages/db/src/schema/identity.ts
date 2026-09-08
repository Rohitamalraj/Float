import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { evmAddress, pk, timestamps } from './_common.js';
import { userRole } from './enums.js';

/** A tenant. Owns one (occasionally more) businesses. */
export const organizations = pgTable('organizations', {
  id: pk(),
  name: text().notNull(),
  ...timestamps,
});

/** A person, identified by an EVM address (SIWE). */
export const users = pgTable(
  'users',
  {
    id: pk(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    address: evmAddress().notNull(),
    email: text(),
    role: userRole().notNull().default('member'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_address_uq').on(t.address), index('users_org_idx').on(t.orgId)],
);

/** Server-side SIWE session. `tokenHash` is a SHA-256 of the opaque cookie value. */
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 64 }).notNull(),
    nonce: varchar({ length: 96 }).notNull(),
    chainId: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    userAgent: text(),
    ip: varchar({ length: 45 }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  org: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
