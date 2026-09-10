'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, useMe } from '@/lib/client';
import { short, statusPill, usd, when } from '@/lib/format';

interface Detail {
  business: {
    ensName: string;
    smartAccountAddress: string | null;
    status: string;
    bufferAmount: string | null;
  } | null;
  policy?: { bufferAmount: string; maxSweepPerTx: string } | null;
  compliance?: { kycStatus: string; accreditation: string; verifiedAt: string | null } | null;
  position?: {
    yieldTokenBalance: string;
    costBasisUsdc: string;
    valueUsdc: string;
    realizedYieldUsdc: string;
    floatSpreadUsdc: string;
  } | null;
  sessionKey?: { agentKeyAddress: string; status: string; grantedAt: string | null } | null;
}

interface Activity {
  sweeps: {
    id: string;
    direction: 'in' | 'out';
    amount: string;
    status: string;
    txHash: string | null;
    decisionReason: string;
    createdAt: string;
  }[];
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { data: me } = useMe();
  useEffect(() => {
    if (me && !me.authenticated) router.replace('/login');
    else if (me && !me.hasBusiness) router.replace('/onboarding');
  }, [me, router]);

  const detail = useQuery({ queryKey: ['business'], queryFn: () => api<Detail>('/api/business') });
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<Activity>('/api/business/activity'),
    enabled: Boolean(detail.data?.business),
  });

  if (detail.isLoading) return <p className="muted">Loading…</p>;
  const d = detail.data;
  if (!d?.business) return <p className="muted">No business yet.</p>;

  const pos = d.position;
  return (
    <div className="stack">
      <div className="between">
        <div>
          <h1>{d.business.ensName}</h1>
          <span className="mono muted">{d.business.smartAccountAddress ?? 'not provisioned'}</span>
        </div>
        <span className={`pill ${statusPill(d.business.status)}`}>{d.business.status}</span>
      </div>

      <div className="grid">
        <Stat
          label="Working buffer"
          value={usd(d.policy?.bufferAmount ?? d.business.bufferAmount)}
          sub={d.policy ? `max sweep ${usd(d.policy.maxSweepPerTx)}` : 'not set'}
        />
        <Stat
          label="Parked in Treasuries"
          value={usd(pos?.valueUsdc)}
          sub={pos ? `cost basis ${usd(pos.costBasisUsdc)}` : '—'}
        />
        <Stat
          label="Yield earned"
          value={usd(pos?.realizedYieldUsdc)}
          sub={pos ? `Float spread ${usd(pos.floatSpreadUsdc)}` : '—'}
        />
        <Stat
          label="Compliance"
          value={d.compliance?.kycStatus ?? '—'}
          sub={
            d.compliance?.verifiedAt
              ? `since ${when(d.compliance.verifiedAt)}`
              : d.compliance?.accreditation
          }
        />
      </div>

      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>Agent session key</h2>
          <span className={`pill ${statusPill(d.sessionKey?.status)}`}>
            {d.sessionKey?.status ?? 'none granted'}
          </span>
        </div>
        {d.sessionKey && (
          <p className="muted" style={{ marginBottom: 0 }}>
            <span className="mono">{short(d.sessionKey.agentKeyAddress)}</span> — granted{' '}
            {when(d.sessionKey.grantedAt)}. Scoped to sweep in/out only, within your per-tx cap.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Recent sweeps</h2>
        {!activity.data?.sweeps.length ? (
          <p className="muted">No sweeps yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Direction</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Why</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.sweeps.map((s) => (
                <tr key={s.id}>
                  <td className="muted">{when(s.createdAt)}</td>
                  <td>{s.direction === 'in' ? 'Park ↗' : 'Redeem ↘'}</td>
                  <td>{usd(s.amount)}</td>
                  <td>
                    <span className={`pill ${statusPill(s.status)}`}>{s.status}</span>
                  </td>
                  <td className="muted">{s.decisionReason}</td>
                  <td className="mono">{s.txHash ? short(s.txHash) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
