import { and, eq } from 'drizzle-orm';
import { obligations } from '@float/db';
import { requireUser } from '@/lib/auth';
import { db, businessForOrg } from '@/lib/repo';
import { handler, notFound, ok } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  const { id } = await ctx.params;

  const body = (await req.json()) as { status?: 'scheduled' | 'covered' | 'paid' | 'cancelled' };
  const [row] = await db
    .update(obligations)
    .set({ status: body.status ?? 'scheduled', updatedAt: new Date() })
    .where(and(eq(obligations.id, id), eq(obligations.businessId, biz.id)))
    .returning();
  if (!row) notFound('obligation not found');
  return ok({ obligation: row });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  const { id } = await ctx.params;
  const [row] = await db
    .update(obligations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(obligations.id, id), eq(obligations.businessId, biz.id)))
    .returning();
  if (!row) notFound('obligation not found');
  return ok({ obligation: row });
});
