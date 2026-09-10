import { currentUser, isAdminAddress } from '@/lib/auth';
import { businessForOrg } from '@/lib/repo';
import { handler, ok } from '@/lib/api';

export const GET = handler(async () => {
  const user = await currentUser();
  if (!user) return ok({ authenticated: false });
  const business = await businessForOrg(user.orgId);
  return ok({
    authenticated: true,
    user: { id: user.id, address: user.address, role: user.role, orgId: user.orgId },
    isAdmin: user.role === 'float_staff' || isAdminAddress(user.address),
    hasBusiness: Boolean(business),
    businessStatus: business?.status ?? null,
  });
});
