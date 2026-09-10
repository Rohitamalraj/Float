'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/lib/client';

export default function Home() {
  const router = useRouter();
  const { data: me, isLoading } = useMe();

  useEffect(() => {
    if (isLoading || !me) return;
    if (!me.authenticated) router.replace('/login');
    else if (!me.hasBusiness) router.replace('/onboarding');
    else router.replace('/dashboard');
  }, [me, isLoading, router]);

  return <p className="muted">Loading…</p>;
}
