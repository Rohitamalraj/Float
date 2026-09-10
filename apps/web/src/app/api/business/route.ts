import { getAddress } from 'viem';
import { namehash } from 'viem/ens';
import { businesses, compliance, kycReviews, type KycDocumentRef } from '@float/db';
import { requireUser } from '@/lib/auth';
import { db, businessDetail, businessForOrg } from '@/lib/repo';
import { chain, env } from '@/lib/chain';
import { bad, handler, ok } from '@/lib/api';

export const GET = handler(async () => {
  const user = await requireUser();
  const detail = await businessDetail(user.orgId);
  return ok(detail ?? { business: null });
});

interface CreateBody {
  ensLabel: string;
  ownerKeyAddress: string;
  accreditation?: 'accredited' | 'non_accredited' | 'unknown';
  disclosuresAcceptedAt?: string;
  documents?: KycDocumentRef[];
}

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  if (await businessForOrg(user.orgId)) bad('this organisation already has a business');

  const body = (await req.json()) as CreateBody;
  const label = (body.ensLabel ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(label)) bad('invalid ENS label');
  if (!body.disclosuresAcceptedAt) bad('you must accept the disclosures to continue');
  let owner: `0x${string}`;
  try {
    owner = getAddress(body.ownerKeyAddress);
  } catch {
    bad('invalid owner address');
  }

  const ensName = `${label}.${env.ENS_PARENT_NAME}`;

  const [biz] = await db
    .insert(businesses)
    .values({
      orgId: user.orgId,
      ensName,
      ensNode: namehash(ensName),
      ownerKeyAddress: owner.toLowerCase(),
      chainId: chain.id,
      status: 'onboarding',
    })
    .returning();

  await db.insert(compliance).values({
    businessId: biz!.id,
    kycStatus: 'pending',
    accreditation: body.accreditation ?? 'unknown',
    source: 'manual_admin',
  });

  await db.insert(kycReviews).values({
    businessId: biz!.id,
    status: 'pending',
    documents: body.documents ?? [],
  });

  return ok({ business: biz, ensName }, { status: 201 });
});
