import { getAddress, parseUnits, type Hex } from 'viem';
import { eq } from 'drizzle-orm';
import { policies } from '@float/db';
import { encodeSetTextRecords } from '@float/ens';
import { requireUser } from '@/lib/auth';
import { db, businessForOrg } from '@/lib/repo';
import { bad, handler, notFound, ok } from '@/lib/api';

const USDC_DP = 6;

export const GET = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  const [pol] = await db.select().from(policies).where(eq(policies.businessId, biz.id)).limit(1);
  return ok({ policy: pol ?? null, ensResolver: biz.ensResolver, ensNode: biz.ensNode });
});

/**
 * Returns the owner-signable calldata to update the working-capital buffer (and
 * optionally the per-tx cap) on the business's ENS policy records. The client
 * sends it from the owner wallet.
 */
export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  if (!biz.ensResolver || !biz.ensNode) bad('business is not fully provisioned yet');

  const body = (await req.json()) as { bufferAmount?: string; maxSweepPerTx?: string };
  const records: Record<string, string> = {};
  if (body.bufferAmount !== undefined) {
    if (!/^\d+(\.\d{1,6})?$/.test(body.bufferAmount)) bad('bufferAmount must be a USDC value');
    records['float.buffer-amount'] = body.bufferAmount;
  }
  if (body.maxSweepPerTx !== undefined) {
    if (!/^\d+(\.\d{1,6})?$/.test(body.maxSweepPerTx)) bad('maxSweepPerTx must be a USDC value');
    records['float.max-sweep-per-tx'] = body.maxSweepPerTx;
  }
  if (Object.keys(records).length === 0) bad('nothing to update');

  const call = encodeSetTextRecords(
    { resolver: getAddress(biz.ensResolver), node: biz.ensNode as Hex },
    records,
  );

  // optimistic mirror — policy-sync will reconcile on-chain
  if (body.bufferAmount !== undefined) {
    await db
      .update(policies)
      .set({
        bufferAmount: parseUnits(body.bufferAmount, USDC_DP).toString(),
        updatedAt: new Date(),
      })
      .where(eq(policies.businessId, biz.id));
  }

  return ok({
    call: { to: call.to, data: call.data, value: '0x0' },
    records,
    note: 'Send this transaction from the business owner wallet. It writes the ENS policy record; FloatPolicyView is reconciled by the agent service.',
  });
});
