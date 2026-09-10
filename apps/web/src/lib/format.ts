export function usd(baseUnits: string | number | null | undefined, decimals = 6): string {
  if (baseUnits == null) return '—';
  const v = Number(BigInt(String(baseUnits).split('.')[0] ?? '0')) / 10 ** decimals;
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

export function short(a?: string | null): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
}

export function when(d?: string | Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function statusPill(s?: string | null): 'good' | 'warn' | 'bad' | '' {
  switch (s) {
    case 'active':
    case 'verified':
    case 'confirmed':
    case 'approved':
      return 'good';
    case 'onboarding':
    case 'pending':
    case 'submitted':
      return 'warn';
    case 'suspended':
    case 'revoked':
    case 'failed':
    case 'rejected':
    case 'expired':
      return 'bad';
    default:
      return '';
  }
}
