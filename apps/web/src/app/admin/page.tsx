'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, useInvalidate, useMe } from '@/lib/client';
import { short, statusPill, when } from '@/lib/format';

interface Review {
  id: string;
  businessId: string;
  ensName: string;
  smartAccount: string | null;
  ownerKeyAddress: string;
  documents: { kind: string; storageKey: string }[];
  submittedAt: string;
}

interface Overview {
  gatewayCalls: number;
  businesses: {
    id: string;
    ensName: string;
    status: string;
    smartAccount: string | null;
    createdAt: string;
    activatedAt: string | null;
  }[];
}

export default function Admin() {
  const router = useRouter();
  const { data: me } = useMe();
  const invalidate = useInvalidate();

  useEffect(() => {
    if (me && (!me.authenticated || !me.isAdmin)) router.replace('/dashboard');
  }, [me, router]);

  const reviews = useQuery({
    queryKey: ['admin-reviews'],
    queryFn: () => api<{ reviews: Review[] }>('/api/admin/kyc-reviews'),
    enabled: Boolean(me?.isAdmin),
  });
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<Overview>('/api/admin/overview'),
    enabled: Boolean(me?.isAdmin),
  });

  async function decide(reviewId: string, decision: 'approve' | 'reject') {
    await api('/api/admin/kyc-reviews', {
      method: 'POST',
      body: JSON.stringify({ reviewId, decision }),
    });
    invalidate('admin-reviews', 'admin-overview');
  }

  if (!me?.isAdmin) return <p className="muted">Admin only.</p>;

  return (
    <div className="stack">
      <h1>Float admin</h1>

      <div className="grid">
        <div className="card stat">
          <div className="label">Businesses</div>
          <div className="value">{overview.data?.businesses.length ?? '—'}</div>
        </div>
        <div className="card stat">
          <div className="label">Pending KYC</div>
          <div className="value">{reviews.data?.reviews.length ?? '—'}</div>
        </div>
        <div className="card stat">
          <div className="label">Gateway calls</div>
          <div className="value">{overview.data?.gatewayCalls ?? '—'}</div>
        </div>
      </div>

      <div className="card">
        <h2>KYC review queue</h2>
        {!reviews.data?.reviews.length ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Owner</th>
                <th>Docs</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviews.data.reviews.map((r) => (
                <tr key={r.id}>
                  <td>{r.ensName}</td>
                  <td className="mono">{short(r.ownerKeyAddress)}</td>
                  <td className="muted">
                    {r.documents.map((d) => d.storageKey).join(', ') || '—'}
                  </td>
                  <td className="muted">{when(r.submittedAt)}</td>
                  <td>
                    <div className="row">
                      <button className="btn primary" onClick={() => void decide(r.id, 'approve')}>
                        Approve
                      </button>
                      <button className="btn danger" onClick={() => void decide(r.id, 'reject')}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>All businesses</h2>
        {!overview.data?.businesses.length ? (
          <p className="muted">None.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Smart account</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {overview.data.businesses.map((b) => (
                <tr key={b.id}>
                  <td>{b.ensName}</td>
                  <td>
                    <span className={`pill ${statusPill(b.status)}`}>{b.status}</span>
                  </td>
                  <td className="mono">{short(b.smartAccount)}</td>
                  <td className="muted">{when(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
