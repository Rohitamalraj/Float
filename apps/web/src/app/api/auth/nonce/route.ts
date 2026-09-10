import { cookies } from 'next/headers';
import { generateSiweNonce } from 'viem/siwe';
import { env } from '@/lib/chain';
import { ok } from '@/lib/api';

export async function GET() {
  const nonce = generateSiweNonce();
  (await cookies()).set('float_siwe_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return ok({ nonce });
}
