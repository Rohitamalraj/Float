'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export interface Me {
  authenticated: boolean;
  user?: { id: string; address: string; role: string; orgId: string };
  isAdmin?: boolean;
  hasBusiness?: boolean;
  businessStatus?: string | null;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me') });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(
    (...keys: string[]) => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    },
    [qc],
  );
}
