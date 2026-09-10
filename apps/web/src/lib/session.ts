import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './chain';

const COOKIE = 'float_session';
const ALG = 'HS256';
const TTL_SECONDS = 60 * 60 * 24 * 7;

const secret = new TextEncoder().encode(env.SESSION_SECRET);

export interface SessionClaims {
  sub: string; // user id
  address: string;
  orgId: string;
}

export async function createSession(claims: SessionClaims): Promise<void> {
  const token = await new SignJWT({ address: claims.address, orgId: claims.orgId })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret);

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export async function readSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (!payload.sub || typeof payload.address !== 'string' || typeof payload.orgId !== 'string') {
      return null;
    }
    return { sub: payload.sub, address: payload.address, orgId: payload.orgId };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
