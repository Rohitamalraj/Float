'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { createSiweMessage } from 'viem/siwe';
import { activeChain } from '@/lib/wagmi';
import { api, useInvalidate } from '@/lib/client';

export default function Login() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const invalidate = useInvalidate();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setErr(undefined);
    try {
      const { nonce } = await api<{ nonce: string }>('/api/auth/nonce');
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Float.',
        uri: window.location.origin,
        version: '1',
        chainId: activeChain.id,
        nonce,
      });
      const signature = await signMessageAsync({ message });
      await api('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ message, signature }),
      });
      invalidate('me');
      router.push('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];

  return (
    <div className="stack" style={{ maxWidth: 420 }}>
      <div>
        <h1>Sign in to Float</h1>
        <p className="muted">
          Connect the wallet that owns your business account, then sign a message — no gas, no
          transaction.
        </p>
      </div>
      <div className="card stack">
        {!isConnected ? (
          <button
            className="btn primary"
            disabled={connecting || !injected}
            onClick={() => injected && connect({ connector: injected })}
          >
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : (
          <>
            <span className="mono muted">{address}</span>
            <button className="btn primary" disabled={busy} onClick={() => void signIn()}>
              {busy ? 'Signing…' : 'Sign in with Ethereum'}
            </button>
          </>
        )}
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}
