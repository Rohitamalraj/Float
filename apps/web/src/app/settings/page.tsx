'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSendTransaction } from 'wagmi';
import type { Hex } from 'viem';
import { api, useInvalidate, useMe } from '@/lib/client';
import { usd, when } from '@/lib/format';

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

  const [buffer, setBuffer] = useState('');
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();

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
        ) : (
          <p className="muted">No active session key. The agent is not operating this wallet.</p>
        )}
      </div>
    </div>
  );
}
