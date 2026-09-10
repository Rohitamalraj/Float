import { eq } from 'drizzle-orm';
import { getDb, users, type User } from '@float/db';
import { env } from './chain';
import { readSession } from './session';

export class Unauthorized extends Error {
  status = 401 as const;
}
export class Forbidden extends Error {
  status = 403 as const;
}

const adminAllowlist = new Set(env.ADMIN_ALLOWLIST.map((a) => a.toLowerCase()));

export function isAdminAddress(address: string): boolean {
  return adminAllowlist.has(address.toLowerCase());
}

export async function currentUser(): Promise<User | null> {
  const session = await readSession();
  if (!session) return null;
  const [row] = await getDb().select().from(users).where(eq(users.id, session.sub)).limit(1);
  return row ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new Unauthorized('sign in required');
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role === 'float_staff' || isAdminAddress(user.address)) return user;
  throw new Forbidden('admin only');
}
