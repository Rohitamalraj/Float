import { and, desc, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  businesses,
  compliance,
  kycReviews,
  obligations,
  organizations,
  policies,
  positions,
  sessionKeys,
  sweeps,
  users,
  type Business,
} from '@float/db';
import { getDb } from '@float/db';

export const db = getDb();

export async function upsertUserByAddress(
  address: string,
): Promise<{ userId: string; orgId: string }> {
  const addr = address.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.address, addr)).limit(1);
  if (existing) return { userId: existing.id, orgId: existing.orgId };

  const [org] = await db
    .insert(organizations)
    .values({ name: `${addr.slice(0, 6)}…${addr.slice(-4)}` })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ orgId: org!.id, address: addr, role: 'owner' })
    .returning();
  return { userId: user!.id, orgId: org!.id };
}

export async function businessForOrg(orgId: string): Promise<Business | undefined> {
  const [row] = await db.select().from(businesses).where(eq(businesses.orgId, orgId)).limit(1);
  return row;
}

export async function businessDetail(orgId: string) {
  const biz = await businessForOrg(orgId);
  if (!biz) return null;
  const [pol] = await db.select().from(policies).where(eq(policies.businessId, biz.id)).limit(1);
  const [comp] = await db
    .select()
    .from(compliance)
    .where(eq(compliance.businessId, biz.id))
    .limit(1);
  const [pos] = await db.select().from(positions).where(eq(positions.businessId, biz.id)).limit(1);
  const [sk] = await db
    .select()
    .from(sessionKeys)
    .where(and(eq(sessionKeys.businessId, biz.id), eq(sessionKeys.status, 'active')))
    .orderBy(desc(sessionKeys.grantedAt))
    .limit(1);
  const [review] = await db
    .select()
    .from(kycReviews)
    .where(eq(kycReviews.businessId, biz.id))
    .orderBy(desc(kycReviews.submittedAt))
    .limit(1);
  return {
    business: biz,
    policy: pol,
    compliance: comp,
    position: pos,
    sessionKey: sk,
    kycReview: review,
  };
}

export async function recentActivity(businessId: string) {
  const recentSweeps = await db
    .select()
    .from(sweeps)
    .where(eq(sweeps.businessId, businessId))
    .orderBy(desc(sweeps.createdAt))
    .limit(20);
  const audit = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.businessId, businessId))
    .orderBy(desc(auditLog.createdAt))
    .limit(30);
  return { sweeps: recentSweeps, audit };
}

export async function listObligations(businessId: string) {
  return db
    .select()
    .from(obligations)
    .where(eq(obligations.businessId, businessId))
    .orderBy(obligations.dueAt);
}

export async function pendingKycReviews() {
  return db
    .select({ review: kycReviews, business: businesses })
    .from(kycReviews)
    .innerJoin(businesses, eq(kycReviews.businessId, businesses.id))
    .where(eq(kycReviews.status, 'pending'))
    .orderBy(kycReviews.submittedAt);
}

export async function adminOverview() {
  const biz = await db.select().from(businesses).orderBy(desc(businesses.createdAt)).limit(100);
  const counted = await db.select({ n: sql<number>`count(*)::int` }).from(sql`gateway_calls`);
  return { businesses: biz, gatewayCalls: counted[0]?.n ?? 0 };
}
