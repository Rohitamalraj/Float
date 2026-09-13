'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSendTransaction, useWalletClient } from 'wagmi';
import { parseUnits, type Hex } from 'viem';
import type { FloatDeployment } from '@float/contracts-sdk';
import { clientWalletRuntimeConfig, grantAgentSessionKey } from '@float/wallet/client';
import { api, useInvalidate, useMe } from '@/lib/client';
import { usd, when } from '@/lib/format';

interface GrantInfo {
  smartAccountAddress: string;
  agentSignerAddress: string;
  deployment: FloatDeployment;
}

interface Obligation {
  id: string;
  label: string;
  amount: string;
  dueAt: string;
  recurrence: string;
  status: string;
}

export default function Settings() {
  const { data: me } = useMe();
  const invalidate = useInvalidate();
  const { sendTransactionAsync } = useSendTransaction();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const policy = useQuery({
    queryKey: ['policy'],
    queryFn: () =>
      api<{ policy: { bufferAmount: string; maxSweepPerTx: string } | null }>(
        '/api/business/policy',
      ),
  });
  const obligations = useQuery({
    queryKey: ['obligations'],
    queryFn: () => api<{ obligations: Obligation[] }>('/api/business/obligations'),
  });
  const sk = useQuery({
    queryKey: ['session-key'],
    queryFn: () =>
      api<{ sessionKeys: { id: string; status: string; agentKeyAddress: string }[] }>(
        '/api/business/session-key',
      ),
  });
  const grantInfo = useQuery({
    queryKey: ['grant-info'],
    queryFn: () => api<GrantInfo>('/api/business/grant-info'),
    retry: false,
  });

  const [buffer, setBuffer] = useState('');
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();

  const [cap, setCap] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantMsg, setGrantMsg] = useState<string>();
  const [grantErr, setGrantErr] = useState<string>();

  async function grantKey() {
    setGrantErr(undefined);
    setGrantMsg(undefined);
    if (!walletClient || !address) {
      setGrantErr('connect your wallet first');
      return;
    }
    if (!publicClient) {
      setGrantErr('no chain connection');
      return;
    }
    if (!grantInfo.data) {
      setGrantErr('grant info not loaded');
      return;
    }
    setGranting(true);
    try {
      const runtime = clientWalletRuntimeConfig();
      const granted = await grantAgentSessionKey({
        publicClient,
        ownerAccount: walletClient,
        agentSignerAddress: grantInfo.data.agentSignerAddress as Hex,
        deployment: grantInfo.data.deployment,
        maxSweepPerTx: parseUnits(cap, 6),
        runtime,
      });
      await api('/api/business/session-key', {
        method: 'POST',
        body: JSON.stringify({
          agentKeyAddress: granted.agentSignerAddress,
          serializedApproval: granted.serializedApproval,
          policySnapshot: {
            maxSweepPerTx: granted.policySnapshot.maxSweepPerTx,
            executor: granted.policySnapshot.executor,
            usdc: granted.policySnapshot.usdc,
            allowedTargets: [
              granted.policySnapshot.executor,
              granted.policySnapshot.usdc,
              granted.policySnapshot.floatUstb,
            ],
            kernelVersion: runtime.kernelVersion,
            entryPoint: runtime.entryPoint.address,
          },
        }),
      });
      setGrantMsg('Agent access granted — the agent can now sweep in/out within the cap.');
      invalidate('session-key', 'business');
    } catch (e) {
      setGrantErr(e instanceof Error ? e.message : 'grant failed');
    } finally {
      setGranting(false);
    }
  }

  async function saveBuffer() {
    setErr(undefined);
    setMsg(undefined);
    try {
      const res = await api<{ call: { to: Hex; data: Hex; value: string } }>(
        '/api/business/policy',
        {
          method: 'PATCH',
          body: JSON.stringify({ bufferAmount: buffer }),
        },
      );
      const hash = await sendTransactionAsync({
        to: res.call.to,
        data: res.call.data,
        value: 0n,
      });
      setMsg(`Buffer updated on-chain (${hash.slice(0, 10)}…). The agent picks it up shortly.`);
      invalidate('policy', 'business');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  const [obl, setObl] = useState({ label: '', amount: '', dueAt: '', recurrence: 'none' });
  async function addObligation() {
    setErr(undefined);
    try {
      await api('/api/business/obligations', { method: 'POST', body: JSON.stringify(obl) });
      setObl({ label: '', amount: '', dueAt: '', recurrence: 'none' });
      invalidate('obligations');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }
  async function cancelObligation(id: string) {
    await api(`/api/business/obligations/${id}`, { method: 'DELETE' });
    invalidate('obligations');
  }

  async function revokeKey() {
    if (!confirm('Revoke the agent session key? The agent stops sweeping immediately.')) return;
    await api('/api/business/session-key', { method: 'DELETE' });
    invalidate('session-key', 'business');
  }

  if (me && !me.authenticated) return <p className="muted">Sign in required.</p>;

  return (
    <div className="stack">
      <h1>Settings</h1>

      <div className="card">
        <h2>Working-capital buffer</h2>
        <p className="muted">
          The amount Float always keeps liquid. Everything above it (net of upcoming obligations) is
          swept into Treasuries. Current: <strong>{usd(policy.data?.policy?.bufferAmount)}</strong>.
        </p>
        <div className="row" style={{ maxWidth: 340 }}>
          <input
            placeholder="e.g. 2000"
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
          />
          <button className="btn primary" disabled={!buffer} onClick={() => void saveBuffer()}>
            Update
          </button>
        </div>
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="err">{err}</p>}
      </div>

      <div className="card">
        <h2>Upcoming obligations</h2>
        <p className="muted">
          Known future outflows. Float keeps liquidity for anything due within its lookahead window.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            style={{ flex: 2 }}
            placeholder="Label (rent, payroll…)"
            value={obl.label}
            onChange={(e) => setObl({ ...obl, label: e.target.value })}
          />
          <input
            style={{ flex: 1 }}
            placeholder="USDC"
            value={obl.amount}
            onChange={(e) => setObl({ ...obl, amount: e.target.value })}
          />
          <input
            style={{ flex: 1 }}
            type="date"
            value={obl.dueAt}
            onChange={(e) => setObl({ ...obl, dueAt: e.target.value })}
          />
          <select
            value={obl.recurrence}
            onChange={(e) => setObl({ ...obl, recurrence: e.target.value })}
            style={{ width: 120 }}
          >
            <option value="none">once</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </select>
          <button className="btn" onClick={() => void addObligation()}>
            Add
          </button>
        </div>
        {obligations.data?.obligations.length ? (
          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Every</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {obligations.data.obligations.map((o) => (
                <tr key={o.id}>
                  <td>{o.label}</td>
                  <td>{usd(o.amount)}</td>
                  <td className="muted">{when(o.dueAt)}</td>
                  <td>{o.recurrence}</td>
                  <td>{o.status}</td>
                  <td>
                    {o.status !== 'cancelled' && (
                      <button className="btn danger" onClick={() => void cancelObligation(o.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">None yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Agent session key</h2>
        {sk.data?.sessionKeys.find((k) => k.status === 'active') ? (
          <div className="between">
            <span className="muted">
              An active key is scoped to sweep in/out only. Revoking cuts the agent off immediately.
            </span>
            <button className="btn danger" onClick={() => void revokeKey()}>
              Revoke
            </button>
          </div>
        ) : grantInfo.isError ? (
          <p className="muted">
            Your account is still being provisioned on-chain — this can take up to a minute after
            signing up. Refresh shortly.
          </p>
        ) : (
          <div className="stack">
            <p className="muted">
              No active session key. Grant one to let Float&rsquo;s agent sweep in/out on your
              behalf — bounded to the exact cap below and nothing else. You sign this with your own
              wallet; Float never holds your key.
            </p>
            <div className="row" style={{ maxWidth: 340 }}>
              <input
                placeholder="Max per-sweep cap, USDC (e.g. 5000)"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
              <button
                className="btn primary"
                disabled={!cap || granting || !grantInfo.data}
                onClick={() => void grantKey()}
              >
                {granting ? 'Granting…' : 'Grant agent access'}
              </button>
            </div>
            {grantMsg && <p className="ok">{grantMsg}</p>}
            {grantErr && <p className="err">{grantErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
