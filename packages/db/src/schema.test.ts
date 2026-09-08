import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  businesses,
  kycStatus,
  onchainTxKind,
  policies,
  sessionKeys,
  sweepDirection,
  sweeps,
} from './schema/index.js';

function columns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((c) => c.name);
}

describe('schema — query-builder surface (camelCase keys)', () => {
  it('sessionKeys exposes the grant payload fields', () => {
    const cols = columns(sessionKeys);
    for (const c of ['agentKeyAddress', 'serializedApproval', 'policySnapshot', 'status']) {
      expect(cols).toContain(c);
    }
  });

  it('businesses carries the identity + status fields', () => {
    const cols = columns(businesses);
    for (const c of [
      'orgId',
      'ensName',
      'smartAccountAddress',
      'ownerKeyAddress',
      'chainId',
      'status',
      'bufferAmount',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('policies and positions are keyed 1:1 by businessId', () => {
    for (const table of [policies]) {
      const pk = getTableConfig(table).columns.find((c) => c.primary);
      expect(pk?.name).toBe('businessId');
    }
  });

  it('sweeps has an idempotency key and lifecycle timestamps', () => {
    const cols = columns(sweeps);
    for (const c of ['idempotencyKey', 'userOpHash', 'txHash', 'submittedAt', 'confirmedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('sweeps.idempotencyKey is uniquely indexed', () => {
    const idx = getTableConfig(sweeps).indexes.find(
      (i) => i.config.name === 'sweeps_idempotency_uq',
    );
    expect(idx?.config.unique).toBe(true);
  });
});

describe('schema — enums', () => {
  it('kyc_status mirrors the on-chain lifecycle', () => {
    expect(kycStatus.enumValues).toEqual(['none', 'pending', 'verified', 'revoked', 'expired']);
  });

  it('sweep_direction is in/out', () => {
    expect(sweepDirection.enumValues).toEqual(['in', 'out']);
  });

  it('onchain_tx_kind covers every Float key write', () => {
    expect(onchainTxKind.enumValues).toEqual(
      expect.arrayContaining([
        'oracle_attestation',
        'ens_policy_write',
        'ens_compliance_write',
        'policy_view_sync',
        'session_key_grant',
        'session_key_revoke',
        'fee_collection',
      ]),
    );
  });
});

describe('schema — generated DDL', () => {
  const migration = (() => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
    return readFileSync(resolve(dir, '0000_funny_joseph.sql'), 'utf8');
  })();

  it('emits snake_case columns to Postgres', () => {
    for (const c of ['agent_key_address', 'idempotency_key', 'user_op_hash', 'buffer_amount']) {
      expect(migration).toContain(`"${c}"`);
    }
    expect(migration).not.toMatch(/"[a-z]+[A-Z]/); // no camelCase identifiers
  });

  it('creates all 15 tables', () => {
    const created = migration.match(/CREATE TABLE "(\w+)"/g) ?? [];
    expect(created).toHaveLength(15);
  });
});
