import { eq } from 'drizzle-orm';
import { businesses, compliance, kycReviews } from '@float/db';
import { requireAdmin } from '@/lib/auth';
import { db, pendingKycReviews } from '@/lib/repo';
import { bad, handler, notFound, ok } from '@/lib/api';

export const GET = handler(async () => {
  await requireAdmin();
  const rows = await pendingKycReviews();
  return ok({
    reviews: rows.map(({ review, business }) => ({
      id: review.id,
      businessId: business.id,
      ensName: business.ensName,
      smartAccount: business.smartAccountAddress,
      ownerKeyAddress: business.ownerKeyAddress,
      documents: review.documents,
      submittedAt: review.submittedAt,
    })),
  });
});

/** Admin decision. `approve` flips the review + compliance rows; the agent service's
 *  oracle-sync then writes the on-chain attestation + ENS mirror. */
export const POST = handler(async (req: Request) => {
  const admin = await requireAdmin();
  const body = (await req.json()) as {
    reviewId?: string;
    decision?: 'approve' | 'reject';
    notes?: string;
  };
  if (!body.reviewId || (body.decision !== 'approve' && body.decision !== 'reject')) {
    bad('reviewId and decision (approve|reject) are required');
  }

  const [review] = await db
    .select()
    .from(kycReviews)
    .where(eq(kycReviews.id, body.reviewId))
    .limit(1);
  if (!review) notFound('review not found');
  if (review.status !== 'pending') bad(`review already ${review.status}`);

  const approved = body.decision === 'approve';
  await db
    .update(kycReviews)
    .set({
      status: approved ? 'approved' : 'rejected',
      reviewedBy: admin.id,
      reviewedAt: new Date(),
      notes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(kycReviews.id, review.id));

  await db
    .update(compliance)
    .set({
      kycStatus: approved ? 'pending' : 'revoked',
      updatedAt: new Date(),
      ...(approved ? {} : { revokedAt: new Date() }),
    })
    .where(eq(compliance.businessId, review.businessId));

  if (approved) {
    await db
      .update(businesses)
      .set({ status: 'active', activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(businesses.id, review.businessId));
  }

  return ok({
    reviewId: review.id,
    decision: body.decision,
    note: approved
      ? 'Approved. The agent service will write the on-chain attestation on its next oracle-sync tick.'
      : 'Rejected.',
  });
});
