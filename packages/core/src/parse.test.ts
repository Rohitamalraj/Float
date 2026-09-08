import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  RecordParseError,
  parseComplianceRecords,
  parsePolicyRecords,
  serializeComplianceRecords,
  serializePolicyRecords,
} from './parse.js';

describe('parsePolicyRecords', () => {
  const good = {
    'float.buffer-amount': '2000',
    'float.max-sweep-per-tx': '10000.5',
    'float.allowed-protocols': '0x00000000000000000000000000000000000000a1',
    'float.target-yield-token': '0x00000000000000000000000000000000000000b2',
  };

  it('parses USDC amounts to 6-decimal base units and checksums addresses', () => {
    const p = parsePolicyRecords(good);
    expect(p.bufferAmount).toBe(parseUnits('2000', 6));
    expect(p.maxSweepPerTx).toBe(parseUnits('10000.5', 6));
    expect(p.allowedProtocol).toBe('0x00000000000000000000000000000000000000A1');
  });

  it('round-trips through serialize', () => {
    expect(serializePolicyRecords(parsePolicyRecords(good))).toMatchObject({
      'float.buffer-amount': '2000',
      'float.max-sweep-per-tx': '10000.5',
    });
  });

  it('rejects a missing key', () => {
    const { ['float.buffer-amount']: _omit, ...rest } = good;
    expect(() => parsePolicyRecords(rest)).toThrow(RecordParseError);
  });

  it('rejects sub-cent precision', () => {
    expect(() => parsePolicyRecords({ ...good, 'float.buffer-amount': '1.1234567' })).toThrow(
      /not a USDC amount/,
    );
  });

  it('rejects a malformed address', () => {
    expect(() => parsePolicyRecords({ ...good, 'float.allowed-protocols': '0xzz' })).toThrow(
      /not an address/,
    );
  });
});

describe('parseComplianceRecords', () => {
  it('defaults to pending/unknown when records are absent', () => {
    const c = parseComplianceRecords({});
    expect(c.kycStatus).toBe('pending');
    expect(c.accreditation).toBe('unknown');
    expect(c.kycVerifiedAt).toBeUndefined();
  });

  it('parses a full verified attestation', () => {
    const c = parseComplianceRecords({
      'float.kyc-status': 'verified',
      'float.accreditation': 'accredited',
      'float.kyc-verified-at': '2026-09-01T00:00:00Z',
      'float.allowlist-id': 'float-ustb-1',
    });
    expect(c.kycStatus).toBe('verified');
    expect(c.kycVerifiedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(c.allowlistId).toBe('float-ustb-1');
  });

  it('rejects an unknown status', () => {
    expect(() => parseComplianceRecords({ 'float.kyc-status': 'banana' })).toThrow(
      RecordParseError,
    );
  });

  it('rejects an unparseable date', () => {
    expect(() =>
      parseComplianceRecords({ 'float.kyc-status': 'verified', 'float.kyc-verified-at': 'soon' }),
    ).toThrow(/not a date/);
  });

  it('round-trips through serialize', () => {
    const input = {
      'float.kyc-status': 'verified',
      'float.accreditation': 'non-accredited',
      'float.kyc-verified-at': '2026-09-01T00:00:00.000Z',
      'float.allowlist-id': 'x',
    };
    expect(serializeComplianceRecords(parseComplianceRecords(input))).toEqual(input);
  });
});
