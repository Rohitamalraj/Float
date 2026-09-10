import { and, eq } from 'drizzle-orm';
import { getAddress } from 'viem';
import { sessionKeys, type SessionKeyPolicySnapshot } from '@float/db';
import { requireUser } from '@/lib/auth';
import { db, businessForOrg } from '@/lib/repo';
import { bad, handler, notFound, ok } from '@/lib/api';

export const GET = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  const rows = await db
    .select()
    .from(sessionKeys)
    .where(eq(sessionKeys.businessId, biz.id))
    .orderBy(sessionKeys.grantedAt);
  return ok({
    sessionKeys: rows.map((r) => ({
      id: r.id,
      agentKeyAddress: r.agentKeyAddress,
      status: r.status,
      policySnapshot: r.policySnapshot,
      grantedAt: r.grantedAt,
      revokedAt: r.revokedAt,
      expiresAt: r.expiresAt,
    })),
  });
});

/** Persist a session key the owner just granted client-side (serialized approval + snapshot). */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');

  const body = (await req.json()) as {
    agentKeyAddress?: string;
    serializedApproval?: string;
    policySnapshot?: SessionKeyPolicySnapshot;
    grantedTxHash?: string;
    expiresAt?: string;
  };
  if (!body.agentKeyAddress || !body.serializedApproval || !body.policySnapshot) {
    bad('agentKeyAddress, serializedApproval and policySnapshot are required');
  }

  await db
    .update(sessionKeys)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessionKeys.businessId, biz.id), eq(sessionKeys.status, 'active')));

  const [row] = await db
    .insert(sessionKeys)
    .values({
      businessId: biz.id,
      agentKeyAddress: getAddress(body.agentKeyAddress).toLowerCase(),
      serializedApproval: body.serializedApproval,
      policySnapshot: body.policySnapshot,
      status: 'active',
      grantedTxHash: body.grantedTxHash,
      grantedAt: new Date(),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    })
    .returning();
  return ok({ sessionKey: row }, { status: 201 });
});

/** Immediate cut-off: the agent service stops the moment there is no active key. */
export const DELETE = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  const rows = await db
    .update(sessionKeys)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessionKeys.businessId, biz.id), eq(sessionKeys.status, 'active')))
    .returning();
  return ok({
    revoked: rows.length,
    note: 'The agent is stopped immediately. For belt-and-suspenders, also uninstall the permission validator on-chain from the owner wallet.',
  });
});
