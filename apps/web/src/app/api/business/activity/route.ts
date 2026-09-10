import { requireUser } from '@/lib/auth';
import { businessForOrg, recentActivity } from '@/lib/repo';
import { handler, notFound, ok } from '@/lib/api';

export const GET = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  return ok(await recentActivity(biz.id));
});
