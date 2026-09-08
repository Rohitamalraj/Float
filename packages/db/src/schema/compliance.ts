import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { hash32, pk, timestamps } from './_common.js';
import { accreditation, complianceSource, kycReviewStatus, kycStatus } from './enums.js';
import { businesses } from './businesses.js';
import { users } from './identity.js';

/**
 * Current compliance state for a business — the off-chain reflection of
 * FloatComplianceRegistry + the ENS `float.kyc-*` records. One row per business,
 * written by the oracle worker.
 */
export const compliance = pgTable('compliance', {
  businessId: uuid()
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  kycStatus: kycStatus().notNull().default('none'),
  accreditation: accreditation().notNull().default('unknown'),
  allowlistId: text(),
  source: complianceSource().notNull().default('manual_admin'),
  verifiedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  registrySyncedAt: timestamp({ withTimezone: true }),
  ensSyncedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

/**
 * The manual review queue that backs the `ManualAdminAdapter` issuer stand-in.
 * `documents` holds references (storage keys / URLs), never the documents.
 */
export const kycReviews = pgTable(
  'kyc_reviews',
  {
    id: pk(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    status: kycReviewStatus().notNull().default('pending'),
    documents: jsonb().$type<KycDocumentRef[]>().notNull().default([]),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    notes: text(),
    /** tx that wrote the resulting attestation, once approved. */
    attestationTxHash: hash32(),
    ...timestamps,
  },
  (t) => [
    index('kyc_reviews_business_idx').on(t.businessId),
    index('kyc_reviews_status_idx').on(t.status),
  ],
);

export interface KycDocumentRef {
  kind: string;
  storageKey: string;
  uploadedAt: string;
}

export const complianceRelations = relations(compliance, ({ one }) => ({
  business: one(businesses, { fields: [compliance.businessId], references: [businesses.id] }),
}));

export const kycReviewsRelations = relations(kycReviews, ({ one }) => ({
  business: one(businesses, { fields: [kycReviews.businessId], references: [businesses.id] }),
  reviewer: one(users, { fields: [kycReviews.reviewedBy], references: [users.id] }),
}));
