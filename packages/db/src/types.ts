import type {
  auditLog,
  businesses,
  compliance,
  gatewayCalls,
  kycReviews,
  obligations,
  onchainTx,
  organizations,
  policies,
  positions,
  sessionKeys,
  sessions,
  sweeps,
  users,
  watcherCursors,
} from './schema/index.js';

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;

export type SessionKey = typeof sessionKeys.$inferSelect;
export type NewSessionKey = typeof sessionKeys.$inferInsert;

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

export type Compliance = typeof compliance.$inferSelect;
export type NewCompliance = typeof compliance.$inferInsert;

export type KycReview = typeof kycReviews.$inferSelect;
export type NewKycReview = typeof kycReviews.$inferInsert;

export type Obligation = typeof obligations.$inferSelect;
export type NewObligation = typeof obligations.$inferInsert;

export type Sweep = typeof sweeps.$inferSelect;
export type NewSweep = typeof sweeps.$inferInsert;

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export type OnchainTx = typeof onchainTx.$inferSelect;
export type NewOnchainTx = typeof onchainTx.$inferInsert;

export type GatewayCall = typeof gatewayCalls.$inferSelect;
export type NewGatewayCall = typeof gatewayCalls.$inferInsert;

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

export type WatcherCursor = typeof watcherCursors.$inferSelect;
export type NewWatcherCursor = typeof watcherCursors.$inferInsert;
