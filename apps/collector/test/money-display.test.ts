import { describe, expect, it } from 'vitest';
import { dong, vnd } from '../src/money.ts';

/**
 * `vnd` is the only thing in this app that touches a money string, so it is
 * the only thing that can quietly corrupt one.
 *
 * The property every case below asserts is the same: **the digits that come
 * out are the digits that went in, in the same order.** `vnd` groups and it
 * drops a fraction that is all zeros; it does not round, sum, or reorder. The
 * server's `quantise` is the one rounding site in the system and this must
 * never become a second one.
 */
const digitsOf = (s: string): string => s.replace(/\D/g, '');

describe('vnd', () => {
  it('drops a fraction that is all zeros and groups the rest in threes', () => {
    expect(vnd('960000.0000')).toBe('960.000');
    expect(vnd('1284000.0000')).toBe('1.284.000');
    expect(vnd('4500.0000')).toBe('4.500');
    expect(vnd('312.0000')).toBe('312');
    expect(vnd('0.0000')).toBe('0');
  });

  it('keeps a fraction the server actually sent', () => {
    // A figure with real centimes is not this function's to round away: the
    // server decided it and the collector is owed what it says.
    expect(vnd('339.9996')).toBe('339,9996');
    expect(vnd('1200.5000')).toBe('1.200,5000');
  });

  it('passes a string with no fractional part straight through', () => {
    expect(vnd('1200')).toBe('1.200');
    expect(vnd('7')).toBe('7');
  });

  it('keeps a sign outside the grouping', () => {
    expect(vnd('-1284000.0000')).toBe('-1.284.000');
  });

  it('never adds, removes or reorders a digit', () => {
    for (const raw of ['960000.0000', '1284000.0000', '339.9996', '0.0000', '7', '-42.5000']) {
      const out = vnd(raw);
      const kept = /^0*$/.test(raw.split('.')[1] ?? '0') ? (raw.split('.')[0] ?? '') : raw;
      expect(digitsOf(out)).toBe(digitsOf(kept));
    }
  });

  it('prints the currency glyph beside the figure and nothing else', () => {
    expect(dong('960000.0000')).toBe('960.000 ₫');
  });
});
