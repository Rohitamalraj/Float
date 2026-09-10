import { cookies } from 'next/headers';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { publicClient } from '@/lib/chain';
import { createSession } from '@/lib/session';
import { upsertUserByAddress } from '@/lib/repo';
import { bad, handler, ok } from '@/lib/api';

export const POST = handler(async (req: Request) => {
  const { message, signature } = (await req.json()) as {
    message?: string;
    signature?: `0x${string}`;
  };
  if (!message || !signature) bad('message and signature are required');

  const nonce = (await cookies()).get('float_siwe_nonce')?.value;
  if (!nonce) bad('missing or expired nonce — request a new one');

  const parsed = parseSiweMessage(message);
  if (parsed.nonce !== nonce) bad('nonce mismatch');
  if (!parsed.address) bad('message has no address');

  const valid = await verifySiweMessage(publicClient(), { message, signature, nonce });
  if (!valid) bad('signature verification failed');

  const { userId, orgId } = await upsertUserByAddress(parsed.address);
  await createSession({ sub: userId, address: parsed.address.toLowerCase(), orgId });
  (await cookies()).delete('float_siwe_nonce');

  return ok({ address: parsed.address.toLowerCase() });
});
