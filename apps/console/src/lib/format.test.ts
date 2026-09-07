/**
 * The two display rules in `format.ts` that a person could be paid — or think
 * they were paid — against.
 *
 * `pace` prints a dash for anything that rounds to nothing, because the seeded
 * and script-decided rows carry 0.022s and would otherwise read "0.0s", which
 * says a reviewer decided instantly. `stampLocal` has to answer a dash for the
 * nulls the recent list really contains rather than "Invalid Date".
 */
import { describe, expect, it } from 'vitest';
import { pace, stampLocal } from './format.ts';

describe('pace', () => {
  it('is a dash for nothing measured', () => {
    expect(pace(null)).toBe('—');
    expect(pace(undefined)).toBe('—');
    expect(pace(Number.NaN)).toBe('—');
  });

  it('is a dash for a zero and for anything that rounds to one', () => {
    expect(pace(0)).toBe('—');
    /* The three values the seed actually stores. */
    expect(pace(0.022)).toBe('—');
    expect(pace(0.043)).toBe('—');
    expect(pace(0.049)).toBe('—');
  });

  it('prints a real pace from the first tenth of a second up', () => {
    expect(pace(0.05)).toBe('0.1s');
    expect(pace(31.44)).toBe('31.4s');
    expect(pace(120)).toBe('120.0s');
  });
});

describe('stampLocal', () => {
  it('is a dash for a missing or unreadable instant', () => {
    expect(stampLocal(null)).toBe('—');
    expect(stampLocal(undefined)).toBe('—');
    expect(stampLocal('not a date')).toBe('—');
  });

  it('reads an instant on the reader’s own clock', () => {
    /* Not asserted against a fixed string: the whole point of this function is
       that it answers in the running machine's zone and locale. What has to
       hold is that a valid instant produces a stamp and not a dash. */
    const out = stampLocal('2026-09-06T18:26:25.552Z');
    expect(out).not.toBe('—');
    expect(out).toMatch(/\d/);
  });
});
