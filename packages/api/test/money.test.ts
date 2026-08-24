import { describe, expect, it } from 'vitest';
import {
  SpanError,
  ZERO,
  add,
  cmp,
  div,
  fromDecimal,
  fromNumber,
  mul,
  normaliseSpans,
  quantise,
  rational,
  settlementFor,
  totalSeconds,
  usefulSeconds,
  type Span,
} from '../src/money.ts';

/**
 * The arithmetic a collector is paid on.
 *
 * No database and no clock in this file, on purpose: the whole point of keeping
 * the money math pure is that a dispute six months from now can be settled by
 * replaying it, and a test that needs Postgres to run cannot make that claim.
 */

const span = (start: number, end: number): Span => ({ start_seconds: start, end_seconds: end });

describe('quantise, the one rounding function', () => {
  it('rounds a half away from zero, in both directions', () => {
    expect(quantise(rational(1n, 2n), 0)).toBe('1');
    expect(quantise(rational(-1n, 2n), 0)).toBe('-1');
    expect(quantise(rational(5n, 2n), 0)).toBe('3');
    expect(quantise(rational(-5n, 2n), 0)).toBe('-3');
    // Not banker's rounding: 2.5 does not go to the even 2.
    expect(quantise(rational(3n, 2n), 0)).toBe('2');
  });

  it('rounds down anything below a half, however close', () => {
    // 0.4999999999 at 0 places.
    expect(quantise(rational(4_999_999_999n, 10_000_000_000n), 0)).toBe('0');
    expect(quantise(rational(-4_999_999_999n, 10_000_000_000n), 0)).toBe('0');
  });

  it('pads to exactly the requested number of places', () => {
    expect(quantise(rational(1n), 6)).toBe('1.000000');
    expect(quantise(ZERO, 6)).toBe('0.000000');
    expect(quantise(rational(1n, 8n), 6)).toBe('0.125000');
  });

  it('never prints negative zero', () => {
    // -0.0000001 at 6 places is zero, and a bill saying "-0.000000" reads as a bug.
    expect(quantise(rational(-1n, 10_000_000n), 6)).toBe('0.000000');
  });

  it('refuses a scale it cannot mean', () => {
    expect(() => quantise(rational(1n), -1)).toThrow(RangeError);
    expect(() => quantise(rational(1n), 1.5)).toThrow(RangeError);
  });
});

describe('exact conversion in, so quantise is the only rounding', () => {
  it('reads a float64 as the rational it actually is, not as what it prints', () => {
    // 0.1 is not a tenth. This is its exact value, and the module can show it.
    expect(quantise(fromNumber(0.1), 20)).toBe('0.10000000000000000555');
    expect(quantise(fromNumber(0.5), 20)).toBe('0.50000000000000000000');
  });

  it('adds floats without their error', () => {
    // The canonical float failure: 0.1 + 0.2 !== 0.3 in JavaScript.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(quantise(add(fromNumber(0.1), fromNumber(0.2)), 6)).toBe('0.300000');
  });

  it('reads a Postgres numeric string exactly', () => {
    expect(cmp(fromDecimal('132.961000'), fromDecimal('132.961'))).toBe(0);
    expect(quantise(fromDecimal('-0.5'), 0)).toBe('-1');
    expect(() => fromDecimal('1e6')).toThrow(RangeError);
    expect(() => fromDecimal('')).toThrow(RangeError);
  });

  it('divides and multiplies without rounding on the way', () => {
    // A third, kept as a third, and rounded once at the end.
    expect(quantise(div(rational(1n), rational(3n)), 6)).toBe('0.333333');
    expect(quantise(mul(div(rational(1n), rational(3n)), rational(3n)), 6)).toBe('1.000000');
  });
});

describe('normalising what the reviewer marked', () => {
  const measured = '100.000000';

  it('keeps a plain, in-order set as it is', () => {
    expect(normaliseSpans([span(10, 20), span(30, 40)], measured)).toEqual([
      { startS: '10.000000', endS: '20.000000' },
      { startS: '30.000000', endS: '40.000000' },
    ]);
  });

  it('sorts what arrives out of order', () => {
    expect(normaliseSpans([span(30, 40), span(10, 20)], measured)).toEqual([
      { startS: '10.000000', endS: '20.000000' },
      { startS: '30.000000', endS: '40.000000' },
    ]);
  });

  it('merges overlaps, so the same second is never paid for twice', () => {
    expect(normaliseSpans([span(10, 25), span(20, 40)], measured)).toEqual([
      { startS: '10.000000', endS: '40.000000' },
    ]);
    expect(totalSeconds(normaliseSpans([span(10, 25), span(20, 40)], measured))).toBe('30.000000');
  });

  it('merges spans that merely touch', () => {
    // Two adjacent regions are one region. Storing them apart suggests a gap.
    expect(normaliseSpans([span(10, 20), span(20, 30)], measured)).toEqual([
      { startS: '10.000000', endS: '30.000000' },
    ]);
  });

  it('swallows a span entirely contained in another', () => {
    expect(normaliseSpans([span(10, 50), span(20, 30)], measured)).toEqual([
      { startS: '10.000000', endS: '50.000000' },
    ]);
  });

  it('clamps to the measured duration at both ends', () => {
    // The video element can run past the payable window: measured duration is
    // the intersection of stream coverage, not the video's own length.
    expect(normaliseSpans([span(-5, 150)], measured)).toEqual([
      { startS: '0.000000', endS: '100.000000' },
    ]);
  });

  it('clamps before merging, so two spans past the end become one', () => {
    expect(normaliseSpans([span(90, 120), span(110, 130)], measured)).toEqual([
      { startS: '90.000000', endS: '100.000000' },
    ]);
  });

  it('drops a span that is empty, or becomes empty once clamped', () => {
    expect(normaliseSpans([span(10, 10), span(20, 30)], measured)).toEqual([
      { startS: '20.000000', endS: '30.000000' },
    ]);
    // Entirely beyond the end: clamps to 100..100 and disappears.
    expect(normaliseSpans([span(120, 130)], measured)).toEqual([]);
    // Shorter than a microsecond: quantises to nothing rather than to a
    // zero-length row the database would refuse.
    expect(normaliseSpans([span(10, 10.0000001)], measured)).toEqual([]);
  });

  it('refuses an inverted span rather than repairing it', () => {
    // Marking out before in is a client bug. Swapping the two silently would
    // hide it behind a payment that looks reasonable.
    expect(() => normaliseSpans([span(30, 10)], measured)).toThrow(SpanError);
  });

  it('refuses a span that is not a pair of finite numbers', () => {
    expect(() => normaliseSpans([span(Number.NaN, 10)], measured)).toThrow(SpanError);
    expect(() => normaliseSpans([span(0, Number.POSITIVE_INFINITY)], measured)).toThrow(SpanError);
  });

  it('sums to exactly the total of the spans it returns', () => {
    // The equality episode_review_spans has to demonstrate and no CHECK can
    // enforce, because a CHECK cannot sum other rows.
    const spans = normaliseSpans(
      [span(1.5, 2.25), span(2.25, 3), span(80, 95), span(90, 99.999999)],
      measured,
    );
    expect(spans).toEqual([
      { startS: '1.500000', endS: '3.000000' },
      { startS: '80.000000', endS: '99.999999' },
    ]);
    expect(totalSeconds(spans)).toBe('21.499999');
  });

  it('holds microsecond boundaries exactly', () => {
    expect(normaliseSpans([span(0.000001, 0.000002)], measured)).toEqual([
      { startS: '0.000001', endS: '0.000002' },
    ]);
  });
});

describe('the useful seconds of a verdict', () => {
  it('pays the whole measured duration for good, not the video length', () => {
    expect(usefulSeconds('good', [], '132.961000')).toBe('132.961000');
    // Spans are irrelevant to a good verdict; the route refuses them outright.
    expect(usefulSeconds('good', [{ startS: '0.000000', endS: '1.000000' }], '8.5')).toBe(
      '8.500000',
    );
  });

  it('pays nothing for bad', () => {
    expect(usefulSeconds('bad', [], '132.961000')).toBe('0.000000');
  });

  it('pays exactly the marked total for partial', () => {
    expect(
      usefulSeconds(
        'partial',
        [
          { startS: '0.000000', endS: '10.000000' },
          { startS: '20.000000', endS: '25.500000' },
        ],
        '132.961000',
      ),
    ).toBe('15.500000');
  });
});

describe('what a verdict is worth', () => {
  it('turns seconds into minutes and minutes into money', () => {
    expect(settlementFor('12.0000', '60.000000')).toEqual({
      effectiveMinutes: '1.000000',
      amount: '12.0000',
    });
    expect(settlementFor('12.0000', '90.000000')).toEqual({
      effectiveMinutes: '1.500000',
      amount: '18.0000',
    });
  });

  it('rounds a repeating minute once, at six places', () => {
    // 100 s is 1.6666… minutes.
    expect(settlementFor('3.0000', '100.000000')).toEqual({
      effectiveMinutes: '1.666667',
      amount: '5.0000',
    });
  });

  it('produces a bill that reproduces its own arithmetic', () => {
    // Anybody who multiplies the two stored columns must get the stored amount.
    // This is why the amount comes from the rounded minutes and not from the
    // exact seconds.
    for (const seconds of ['1.000000', '7.333333', '132.961000', '0.000001', '3599.999999']) {
      const { effectiveMinutes, amount } = settlementFor('2.7500', seconds);
      expect(quantise(mul(fromDecimal('2.7500'), fromDecimal(effectiveMinutes)), 4)).toBe(amount);
    }
  });

  it('bills from the rounded minutes, visibly, rather than from the exact seconds', () => {
    /**
     * The one case where the choice shows. 16 seconds is 0.2666... minutes; at
     * 1200 a minute the exact amount is 320.0000 and this returns 320.0004,
     * because the amount comes from the minutes as stored.
     *
     * Pinned rather than tolerated. Somebody will read 320.0004 as a rounding
     * bug and "fix" it to the exact value, and the fix would leave every bill
     * unable to reproduce its own arithmetic: unit_price x effective_minutes
     * would no longer equal amount, which is the first thing checked when a
     * collector disputes one.
     */
    const bill = settlementFor('1200.0000', '16.000000');
    expect(bill).toEqual({ effectiveMinutes: '0.266667', amount: '320.0004' });
    expect(quantise(mul(fromDecimal('1200.0000'), fromDecimal(bill.effectiveMinutes)), 4)).toBe(
      bill.amount,
    );
    // What it is not, and deliberately so.
    expect(quantise(div(mul(fromDecimal('1200.0000'), fromDecimal('16.000000')), rational(60n)), 4)).toBe(
      '320.0000',
    );
  });

  it('bills nothing for a failed review', () => {
    expect(settlementFor('12.0000', '0.000000')).toEqual({
      effectiveMinutes: '0.000000',
      amount: '0.0000',
    });
  });

  it('does not lose a fraction of a cent to float arithmetic', () => {
    // 0.1 * 3 is 0.30000000000000004 in float64. Not here.
    const { amount } = settlementFor('0.1000', '180.000000');
    expect(amount).toBe('0.3000');
  });
});
