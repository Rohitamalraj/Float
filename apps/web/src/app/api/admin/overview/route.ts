import { requireAdmin } from '@/lib/auth';
import { adminOverview } from '@/lib/repo';
import { handler, ok } from '@/lib/api';

export const GET = handler(async () => {
  await requireAdmin();
  const { businesses, gatewayCalls } = await adminOverview();
  return ok({
    gatewayCalls,
    businesses: businesses.map((b) => ({
      id: b.id,
      ensName: b.ensName,
      status: b.status,
      smartAccount: b.smartAccountAddress,
      createdAt: b.createdAt,
      activatedAt: b.activatedAt,
    })),
  });
});
