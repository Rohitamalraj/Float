'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { api, useInvalidate, useMe } from '@/lib/client';

const DISCLOSURES = [
  'Float is non-custodial: I own the smart account and can recover it independently of Float.',
  'Swept funds sit in a tokenized-Treasury position — not FDIC-insured, and carry smart-contract risk.',
  'Float’s decision to allocate my funds for a yield spread may constitute investment advice; this is not legal advice.',
  'Private-fund Treasury products may require accredited-investor status, which is a separate gate from KYC.',
];

export default function Onboarding() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: me } = useMe();
  const invalidate = useInvalidate();

  const [step, setStep] = useState(0);
  const [label, setLabel] = useState('');
  const [checked, setChecked] = useState<boolean[]>(DISCLOSURES.map(() => false));
  const [accreditation, setAccreditation] = useState<'accredited' | 'non_accredited' | 'unknown'>(
    'unknown',
  );
  const [docNote, setDocNote] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    if (!me.authenticated) router.replace('/login');
    else if (me.hasBusiness) router.replace('/dashboard');
  }, [me, router]);

  if (!me || !me.authenticated || me.hasBusiness) return <p className="muted">Loading…</p>;

  const allChecked = checked.every(Boolean);
  const parent = process.env.NEXT_PUBLIC_ENS_PARENT ?? 'float.eth';

  async function submit() {
    setBusy(true);
    setErr(undefined);
    try {
      await api('/api/business', {
        method: 'POST',
        body: JSON.stringify({
          ensLabel: label,
          ownerKeyAddress: address,
          accreditation,
          disclosuresAcceptedAt: new Date().toISOString(),
          documents: docNote
            ? [{ kind: 'note', storageKey: docNote, uploadedAt: new Date().toISOString() }]
            : [],
        }),
      });
      invalidate('me', 'business');
      router.push('/dashboard');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>Set up your Float wallet</h1>
      <div className="steps">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`dot ${i <= step ? 'on' : ''}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="card stack">
          <h2>Name your wallet</h2>
          <div className="field">
            <label>ENS label</label>
            <div className="row">
              <input
                placeholder="rosa-design"
                value={label}
                onChange={(e) => setLabel(e.target.value.toLowerCase())}
              />
              <span className="muted mono">.{parent}</span>
            </div>
          </div>
          <p className="muted">
            Clients and agents will pay{' '}
            <span className="mono">
              {label || 'yourname'}.{parent}
            </span>{' '}
            directly. It resolves to your non-custodial smart account.
          </p>
          <button className="btn primary" disabled={!label} onClick={() => setStep(1)}>
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="card stack">
          <h2>Disclosures</h2>
          {DISCLOSURES.map((d, i) => (
            <label key={i} className="row" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', marginTop: 3 }}
                checked={checked[i]}
                onChange={(e) => {
                  const next = [...checked];
                  next[i] = e.target.checked;
                  setChecked(next);
                }}
              />
              <span>{d}</span>
            </label>
          ))}
          <div className="row">
            <button className="btn" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn primary" disabled={!allChecked} onClick={() => setStep(2)}>
              I understand
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card stack">
          <h2>Accreditation</h2>
          <p className="muted">
            Some tokenized-Treasury products are gated to accredited investors. This does not block
            onboarding — it determines which venues are available to you.
          </p>
          <div className="field">
            <select
              value={accreditation}
              onChange={(e) => setAccreditation(e.target.value as typeof accreditation)}
            >
              <option value="unknown">Prefer not to say</option>
              <option value="accredited">
                Accredited (entity: $5M+ total assets, or all owners accredited)
              </option>
              <option value="non_accredited">Not accredited</option>
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn primary" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card stack">
          <h2>KYC</h2>
          <p className="muted">
            Float’s issuer partner verifies your business once. Paste a reference to your submitted
            documents (or a data-room link); a Float reviewer approves it, then your on-chain
            compliance attestation is written.
          </p>
          <div className="field">
            <label>Document reference</label>
            <input
              placeholder="data-room URL or ticket id"
              value={docNote}
              onChange={(e) => setDocNote(e.target.value)}
            />
          </div>
          {err && <p className="err">{err}</p>}
          <div className="row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button
              className="btn primary"
              disabled={busy || !isConnected}
              onClick={() => void submit()}
            >
              {busy ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
