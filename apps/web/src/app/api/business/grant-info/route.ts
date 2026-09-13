import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requireEnv } from '@float/config';
import { requireUser } from '@/lib/auth';
import { env, requireDeployment } from '@/lib/chain';
import { businessForOrg } from '@/lib/repo';
import { handler, notFound, ok } from '@/lib/api';

/**
 * Everything the browser needs to grant the agent session key itself — the
 * owner's wallet signs client-side (Float never holds that key), so the
 * grant call runs in `apps/web`, not the agent service. Only public
 * addresses; no secret ever leaves the server.
 */
export const GET = handler(async () => {
  const user = await requireUser();
  const biz = await businessForOrg(user.orgId);
  if (!biz) notFound('no business');
  if (!biz.smartAccountAddress) notFound('business is not ENS-provisioned yet');

  const deployment = requireDeployment();
  const agentSignerAddress = privateKeyToAccount(
    requireEnv('AGENT_SESSION_SIGNER_PRIVATE_KEY', 'derive the public agent address', env) as Hex,
  ).address;

  return ok({
    smartAccountAddress: biz.smartAccountAddress,
    ownerKeyAddress: biz.ownerKeyAddress,
    agentSignerAddress,
    deployment,
  });
});
