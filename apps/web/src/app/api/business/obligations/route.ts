import { parseUnits } from 'viem';
import { obligations } from '@float/db';
import { requireUser } from '@/lib/auth';
import { db, businessForOrg, listObligations } from '@/lib/repo';
import { bad, handler, notFound, ok } from '@/lib/api';

export const GET = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  return ok({ obligations: await listObligations(biz.id) });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');

  const body = (await req.json()) as {
    label?: string;
    amount?: string;
    dueAt?: string;
    recurrence?: 'none' | 'weekly' | 'monthly';
  };
  if (!body.label?.trim()) bad('label is required');
  if (!body.amount || !/^\d+(\.\d{1,6})?$/.test(body.amount)) bad('amount must be a USDC value');
  const dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) bad('dueAt must be a valid date');

  const [row] = await db
    .insert(obligations)
    .values({
      businessId: biz.id,
      label: body.label.trim(),
      amount: parseUnits(body.amount, 6).toString(),
      dueAt,
      recurrence: body.recurrence ?? 'none',
      createdBy: user.id,
    })
    .returning();
  return ok({ obligation: row }, { status: 201 });
});
