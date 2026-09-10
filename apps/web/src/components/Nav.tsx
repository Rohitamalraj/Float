'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount, useDisconnect } from 'wagmi';
import { api, useInvalidate, useMe } from '@/lib/client';

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: me } = useMe();
  const invalidate = useInvalidate();

  const link = (href: string, label: string) => (
    <Link href={href} className={path === href ? 'active' : ''}>
      {label}
    </Link>
  );

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    disconnect();
    invalidate('me');
    router.push('/login');
  }

  return (
    <nav className="nav">
      <span className="brand">FLOAT</span>
      {me?.authenticated && (
        <>
          {link('/dashboard', 'Dashboard')}
          {link('/settings', 'Settings')}
          {me.isAdmin && link('/admin', 'Admin')}
        </>
      )}
      <span className="spacer" />
      {me?.authenticated ? (
        <>
          <span className="mono muted">{short(me.user?.address ?? address)}</span>
          <button className="btn" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        link('/login', 'Sign in')
      )}
    </nav>
  );
}
