import { describe, expect, it } from 'vitest';
import {
  ALL_COMPLIANCE_KEYS,
  ALL_FLOAT_RECORD_KEYS,
  ALL_POLICY_KEYS,
  COMPLIANCE_KEYS,
  POLICY_KEYS,
  isComplianceKey,
  isPolicyKey,
} from './record-keys.js';

describe('record keys', () => {
  it('policy and compliance key sets are disjoint', () => {
    const overlap = ALL_POLICY_KEYS.filter((k) => (ALL_COMPLIANCE_KEYS as string[]).includes(k));
    expect(overlap).toEqual([]);
  });

  it('combined set is the union with no duplicates', () => {
    expect(new Set(ALL_FLOAT_RECORD_KEYS).size).toBe(
      ALL_POLICY_KEYS.length + ALL_COMPLIANCE_KEYS.length,
    );
  });

  it('classifies keys correctly', () => {
    expect(isPolicyKey(POLICY_KEYS.bufferAmount)).toBe(true);
    expect(isPolicyKey(COMPLIANCE_KEYS.kycStatus)).toBe(false);
    expect(isComplianceKey(COMPLIANCE_KEYS.kycStatus)).toBe(true);
    expect(isComplianceKey('float.buffer-amount')).toBe(false);
    expect(isPolicyKey('com.twitter')).toBe(false);
  });

  it('all keys are namespaced under `float.`', () => {
    for (const key of ALL_FLOAT_RECORD_KEYS) {
      expect(key.startsWith('float.')).toBe(true);
    }
  });
});
