import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import {
  auditLog,
  businesses,
  compliance,
  kycReviews,
  obligations,
  onchainTx,
  policies,
  positions,
  sessionKeys,
  sweeps,
  watcherCursors,
  type Business,
  type Database,
  type NewAuditLog,
  type NewOnchainTx,
  type NewSweep,
  type SessionKey,
} from '@float/db';

export async function listActiveBusinesses(db: Database): Promise<Business[]> {
  return db.select().from(businesses).where(eq(businesses.status, 'active'));
}

export async function getBusiness(db: Database, id: string): Promise<Business | undefined> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  return row;
}

export async function getBusinessBySmartAccount(
  db: Database,
  address: string,
): Promise<Business | undefined> {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.smartAccountAddress, address.toLowerCase()))
    .limit(1);
  return row;
}

/** Onboarded businesses that still need their ENS subname + smart account. */
export async function businessesAwaitingProvisioning(db: Database): Promise<Business[]> {
  return db
    .select()
    .from(businesses)
    .where(and(eq(businesses.status, 'onboarding'), isNull(businesses.smartAccountAddress)));
}

export async function markBusinessProvisioned(
  db: Database,
  businessId: string,
  patch: { smartAccountAddress: string; ensResolver: string },
): Promise<void> {
  await db
    .update(businesses)
    .set({
      smartAccountAddress: patch.smartAccountAddress.toLowerCase(),
      ensResolver: patch.ensResolver,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId));
}

export async function getActiveSessionKey(
  db: Database,
  businessId: string,
): Promise<SessionKey | undefined> {
  const [row] = await db
    .select()
    .from(sessionKeys)
    .where(and(eq(sessionKeys.businessId, businessId), eq(sessionKeys.status, 'active')))
    .orderBy(desc(sessionKeys.grantedAt))
    .limit(1);
  return row;
}

export async function getPolicyMirror(db: Database, businessId: string) {
  const [row] = await db
    .select()
    .from(policies)
    .where(eq(policies.businessId, businessId))
    .limit(1);
  return row;
}

export async function upcomingObligations(db: Database, businessId: string, horizon: Date) {
  return db
    .select()
    .from(obligations)
    .where(
      and(
        eq(obligations.businessId, businessId),
        inArray(obligations.status, ['scheduled', 'covered']),
        lte(obligations.dueAt, horizon),
      ),
    );
}

export async function findSweepByIdempotencyKey(db: Database, key: string) {
  const [row] = await db.select().from(sweeps).where(eq(sweeps.idempotencyKey, key)).limit(1);
  return row;
}

export async function insertSweep(db: Database, row: NewSweep) {
  const [created] = await db.insert(sweeps).values(row).returning();
  return created!;
}

export async function updateSweep(
  db: Database,
  id: string,
  patch: Partial<NewSweep>,
): Promise<void> {
  await db
    .update(sweeps)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sweeps.id, id));
}

export async function insertOnchainTx(db: Database, row: NewOnchainTx) {
  const [created] = await db.insert(onchainTx).values(row).returning();
  return created!;
}

export async function markOnchainTx(
  db: Database,
  id: string,
  patch: Partial<NewOnchainTx>,
): Promise<void> {
  await db
    .update(onchainTx)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(onchainTx.id, id));
}

export async function appendAudit(db: Database, row: NewAuditLog): Promise<void> {
  await db.insert(auditLog).values(row);
}

/** kyc_reviews that admins approved but whose on-chain attestation has not been written. */
export async function pendingApprovedReviews(db: Database) {
  return db
    .select({
      review: kycReviews,
      business: businesses,
    })
    .from(kycReviews)
    .innerJoin(businesses, eq(kycReviews.businessId, businesses.id))
    .where(and(eq(kycReviews.status, 'approved'), isNull(kycReviews.attestationTxHash)));
}

export async function markReviewAttested(
  db: Database,
  reviewId: string,
  txHash: string,
): Promise<void> {
  await db
    .update(kycReviews)
    .set({ attestationTxHash: txHash, updatedAt: new Date() })
    .where(eq(kycReviews.id, reviewId));
}

export async function upsertCompliance(
  db: Database,
  businessId: string,
  patch: Partial<typeof compliance.$inferInsert>,
): Promise<void> {
  await db
    .insert(compliance)
    .values({ businessId, ...patch })
    .onConflictDoUpdate({
      target: compliance.businessId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function upsertPolicyMirror(
  db: Database,
  businessId: string,
  patch: Omit<typeof policies.$inferInsert, 'businessId'>,
): Promise<void> {
  await db
    .insert(policies)
    .values({ businessId, ...patch })
    .onConflictDoUpdate({
      target: policies.businessId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function upsertPosition(
  db: Database,
  businessId: string,
  patch: Omit<typeof positions.$inferInsert, 'businessId'>,
): Promise<void> {
  await db
    .insert(positions)
    .values({ businessId, ...patch })
    .onConflictDoUpdate({
      target: positions.businessId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function getWatcherCursor(db: Database, id: string): Promise<bigint | undefined> {
  const [row] = await db.select().from(watcherCursors).where(eq(watcherCursors.id, id)).limit(1);
  return row?.lastBlock;
}

export async function setWatcherCursor(db: Database, id: string, lastBlock: bigint): Promise<void> {
  await db
    .insert(watcherCursors)
    .values({ id, lastBlock })
    .onConflictDoUpdate({ target: watcherCursors.id, set: { lastBlock, updatedAt: new Date() } });
}
