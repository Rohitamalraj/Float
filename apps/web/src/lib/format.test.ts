import { describe, expect, it } from 'vitest';
import { short, statusPill, usd } from './format';

describe('usd', () => {
  it('formats 6-decimal base units as currency', () => {
    expect(usd('2000000000')).toBe('$2,000.00');
    expect(usd('12345678')).toBe('$12.35');
    expect(usd(0)).toBe('$0.00');
  });
  it('handles null/undefined', () => {
    expect(usd(null)).toBe('—');
    expect(usd(undefined)).toBe('—');
  });
  it('ignores any fractional part on the raw string', () => {
    expect(usd('2000000000.0')).toBe('$2,000.00');
  });
});

describe('short', () => {
  it('truncates an address', () => {
    expect(short('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(short(null)).toBe('—');
  });
});

describe('statusPill', () => {
  it('maps lifecycle states to a tone', () => {
    expect(statusPill('active')).toBe('good');
    expect(statusPill('pending')).toBe('warn');
    expect(statusPill('failed')).toBe('bad');
    expect(statusPill('whatever')).toBe('');
  });
});
