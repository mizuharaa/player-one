/**
 * The arithmetic between a reviewer's marks and a collector's payment.
 *
 * Everything here is pure: no database, no clock, no randomness. The same
 * inputs give the same decimal strings on any machine, in any year, which is
 * what makes a payment dispute answerable by replay rather than by argument —
 * the same property `resolve.ts` has and for the same reason.
 *
 * Two rules run through the whole module.
 *
 * **Nothing is a float past the front door.** A span boundary arrives from the
 * browser as a JSON number, because `video.currentTime` is one; it is converted
 * to an exact rational immediately and never touched as a float again. Every
 * other value — the measured duration, the unit price — arrives from Postgres
 * as a decimal string and stays exact. `0.1 + 0.2` has no business anywhere
 * near a number somebody is paid.
 *
 * **Rounding happens in exactly one function.** `quantise` is it. Every other
 * function here is exact by construction: rational arithmetic on BigInts cannot
 * round, so it cannot round differently in two places. If a second rounding
 * site ever appears in this file, the guarantee is gone whether or not the two
 * rules agree today.
 */

/**
 * An exact rational. `d > 0` always, and the pair is kept in lowest terms so a
 * long chain of operations cannot grow the denominator without bound.
 *
 * This exists because the alternative — a scaled integer — needs a scale chosen
 * up front, and the scales here differ: seconds are stored at 6 decimal places,
 * a unit price at 4, and a float64 span boundary is a dyadic rational with up
 * to 1074. One type that holds all of them exactly is simpler than three that
 * each nearly do.
 */
export type Rational = { readonly n: bigint; readonly d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};

const reduce = (n: bigint, d: bigint): Rational => {
  if (d === 0n) throw new RangeError('rational with zero denominator');
  const [sn, sd] = d < 0n ? [-n, -d] : [n, d];
  const g = gcd(sn, sd);
  return { n: sn / g, d: sd / g };
};

export const rational = (n: bigint, d: bigint = 1n): Rational => reduce(n, d);

export const ZERO: Rational = { n: 0n, d: 1n };

export const add = (a: Rational, b: Rational): Rational =>
  reduce(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational =>
  reduce(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => reduce(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => {
  if (b.n === 0n) throw new RangeError('division by zero');
  return reduce(a.n * b.d, a.d * b.n);
};

/** Negative, zero or positive, like a comparator. Exact — no float ever sees these. */
export const cmp = (a: Rational, b: Rational): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

export const min = (a: Rational, b: Rational): Rational => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Rational, b: Rational): Rational => (cmp(a, b) >= 0 ? a : b);

/**
 * A decimal string to an exact rational. Accepts what Postgres `numeric` sends
 * back and what a caller would reasonably type: an optional sign, digits, an
 * optional fractional part. No exponent notation — `numeric` does not produce
 * it, and accepting a format we never see is untested surface on the money
 * path.
 */
export function fromDecimal(text: string): Rational {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (m === null) throw new RangeError(`not a decimal number: ${JSON.stringify(text)}`);
  const [, sign, whole, frac = ''] = m;
  const digits = BigInt(whole! + frac);
  return reduce(sign === '-' ? -digits : digits, 10n ** BigInt(frac.length));
}

/**
 * A JavaScript number to an exact rational — exact, not approximately so.
 *
 * Every finite float64 *is* a rational: `m / 2^k` for integers m and k. Doubling
 * until the value is integral recovers that pair with no loss, which matters
 * because this is the one place a float enters the money path. Rounding here
 * instead — `toFixed`, or scaling by a million — would be a second rounding
 * site with its own rule, and the point of `quantise` is that there is only one.
 *
 * The loop terminates: a float64 with a fractional part has magnitude below
 * 2^52, and doubling it at most 1074 times reaches an integer below 2^53, which
 * `BigInt` converts exactly.
 */
export function fromNumber(x: number): Rational {
  if (!Number.isFinite(x)) throw new RangeError(`not a finite number: ${x}`);
  let d = 1n;
  let v = x;
  while (!Number.isInteger(v)) {
    v *= 2;
    d *= 2n;
  }
  return reduce(BigInt(v), d);
}

/**
 * The two rules this module rounds by. Two rules, still one function: which
 * rule applies is a caller's decision, and where the arithmetic happens is not.
 *
 * `half-away` — a value exactly halfway between two representable results goes
 * to the one with the larger magnitude, 0.5 to 1 and −0.5 to −1. Not banker's
 * rounding, which would be defensible statistically and indefensible to a
 * collector who noticed that two identical reviews were paid differently. This
 * is the default and everything on the review side uses it.
 *
 * `floor` — towards negative infinity. Daniel took this decision on 2026-08-27
 * for one value only: the whole number of dong a bill is paid in. A transfer
 * moves whole dong and a bill total does not land on one, so somebody has to
 * lose the fraction, and the platform is not allowed to pay a collector more
 * than the reviewed footage was worth. Applied ONCE per bill, to the total, so
 * the loss is under one dong per bill however many lines it has. It is not
 * applied to a line: see `settlementFor`.
 */
export type Rounding = 'half-away' | 'floor';

/**
 * The one rounding function.
 *
 * Returns a decimal string with exactly `decimals` places, ready for a
 * `numeric` column. Never a number: handing this back as a float would undo the
 * entire module on the last hop.
 */
export function quantise(value: Rational, decimals: number, rule: Rounding = 'half-away'): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new RangeError(`decimals out of range: ${decimals}`);
  }
  const scale = 10n ** BigInt(decimals);
  const negative = value.n < 0n;
  const n = negative ? -value.n : value.n;

  // Scaled quotient and remainder of |value| — both exact.
  const scaled = n * scale;
  const q = scaled / value.d;
  const r = scaled % value.d;

  // Both branches work on the MAGNITUDE, which the sign is put back on below.
  // `2r >= d` is "the discarded part is at least a half", with no division and
  // so no rounding of its own. For `floor`, a positive value drops its
  // remainder and a negative one grows in magnitude, which is what towards
  // negative infinity means on either side of zero.
  const rounded =
    rule === 'floor'
      ? negative && r !== 0n
        ? q + 1n
        : q
      : 2n * r >= value.d
        ? q + 1n
        : q;

  const whole = rounded / scale;
  const frac = rounded % scale;
  const body =
    decimals === 0 ? whole.toString() : `${whole}.${frac.toString().padStart(decimals, '0')}`;
  // "-0.000000" is arithmetically right and reads like a mistake in a bill.
  return negative && rounded !== 0n ? `-${body}` : body;
}

// ---------------------------------------------------------------------------
// Spans

/** What the client sends. Seconds, because that is what a `<video>` element speaks. */
export type Span = { start_seconds: number; end_seconds: number };

/** What is stored, and what the sum is taken over. Decimal strings at scale 6. */
export type NormalisedSpan = { startS: string; endS: string };

/** Rejected input, as opposed to a bug. Every route that catches this answers 422. */
export class SpanError extends Error {}

/** Seconds are stored at microsecond resolution, which is the engine's own unit. */
export const SECONDS_SCALE = 6;

/**
 * Turns what a reviewer marked into what can be paid for, in a fixed order:
 * validate, clamp, quantise, drop the empty, sort, merge.
 *
 * The order is not arbitrary. Clamping before merging means a span running past
 * the end of the footage merges with whatever preceded it instead of surviving
 * as a separate region beyond the media. Quantising before dropping empties
 * means a span shorter than a microsecond is dropped rather than stored as a
 * zero-length row the database would refuse. Merging last means the sum is over
 * disjoint intervals, so overlapping marks — which the client deliberately
 * allows, because forbidding them would make marking fiddly — cannot pay twice
 * for the same second.
 *
 * The returned spans are disjoint, ascending, and their total is exactly
 * `totalSeconds` of them. That equality is what `episode_reviews`'
 * `effective_duration_s` claims and what `episode_review_spans` has to be able
 * to demonstrate; it cannot be a CHECK because a CHECK cannot sum other rows,
 * so it is a property of this function and is tested here.
 */
export function normaliseSpans(
  spans: readonly Span[],
  measuredDurationS: string,
): NormalisedSpan[] {
  const measured = fromDecimal(measuredDurationS);
  if (cmp(measured, ZERO) < 0) throw new SpanError('measured duration is negative');

  const clamped: { start: Rational; end: Rational }[] = [];
  for (const [i, span] of spans.entries()) {
    if (!Number.isFinite(span.start_seconds) || !Number.isFinite(span.end_seconds)) {
      throw new SpanError(`span ${i} is not a pair of finite numbers`);
    }
    const rawStart = fromNumber(span.start_seconds);
    const rawEnd = fromNumber(span.end_seconds);
    /**
     * Inverted is refused, not repaired. A span whose end precedes its start is
     * a client that marked out before in, and quietly swapping the two would
     * hide the bug behind a payment that looks reasonable. Zero-length is a
     * different thing — a reviewer who pressed i and o together — and is
     * dropped below, which is the spec's own rule.
     */
    if (cmp(rawEnd, rawStart) < 0) throw new SpanError(`span ${i} ends before it starts`);

    const start = max(ZERO, min(rawStart, measured));
    const end = max(ZERO, min(rawEnd, measured));
    clamped.push({ start, end });
  }

  const quantised = clamped
    .map(({ start, end }) => ({
      start: quantise(start, SECONDS_SCALE),
      end: quantise(end, SECONDS_SCALE),
    }))
    .map(({ start, end }) => ({ start: micros(start), end: micros(end) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => (a.start === b.start ? cmpBig(a.end, b.end) : cmpBig(a.start, b.start)));

  const merged: { start: bigint; end: bigint }[] = [];
  for (const span of quantised) {
    const last = merged[merged.length - 1];
    // `<=` and not `<`: two spans that touch are one region of useful footage,
    // and storing them separately would suggest a gap that is not there.
    if (last !== undefined && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  return merged.map(({ start, end }) => ({ startS: fromMicros(start), endS: fromMicros(end) }));
}

/** Exact: scale-6 strings are integers of microseconds, and this is the conversion. */
const micros = (decimal6: string): bigint => {
  const r = fromDecimal(decimal6);
  const scaled = r.n * 1_000_000n;
  if (scaled % r.d !== 0n) throw new RangeError(`${decimal6} is not a whole number of microseconds`);
  return scaled / r.d;
};

const fromMicros = (n: bigint): string => quantise(rational(n, 1_000_000n), SECONDS_SCALE);

const cmpBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** The sum of disjoint spans. Exact — no rounding, because none is needed. */
export function totalSeconds(spans: readonly NormalisedSpan[]): string {
  let total = 0n;
  for (const s of spans) total += micros(s.endS) - micros(s.startS);
  return fromMicros(total);
}

// ---------------------------------------------------------------------------
// The verdict

export type Decision = 'good' | 'partial' | 'bad';

/**
 * §6.9's three outcomes, and the only place the number a collector is paid on
 * is decided.
 *
 *   good     every measured second is useful
 *   bad      none of it is, and the review row's own CHECK insists on zero
 *   partial  exactly what the reviewer marked, once normalised
 *
 * `good` returns the measured duration rather than the media's own end, and the
 * distinction matters: measured duration is the intersection of stream
 * coverage, which is what §5.3.3 and UPL-14 make payable, and the video element
 * the reviewer watched may run longer than that. Paying the video's length
 * would pay for seconds no IMU covered.
 */
export function usefulSeconds(
  decision: Decision,
  spans: readonly NormalisedSpan[],
  measuredDurationS: string,
): string {
  switch (decision) {
    case 'good':
      return quantise(fromDecimal(measuredDurationS), SECONDS_SCALE);
    case 'bad':
      return quantise(ZERO, SECONDS_SCALE);
    case 'partial':
      return totalSeconds(spans);
  }
}

/** The review states §6.9 names, which are what `episode_reviews_state_check` allows. */
export const REVIEW_STATE: Record<Decision, 'pass' | 'partial_pass' | 'fail'> = {
  good: 'pass',
  partial: 'partial_pass',
  bad: 'fail',
};

export const MINUTES_SCALE = 6;
export const MONEY_SCALE = 4;

/**
 * What one verdict is worth, as the bill will state it.
 *
 * `amount` is computed from the *rounded* minutes rather than from the exact
 * seconds, and that is deliberate. A bill has to explain its own arithmetic:
 * anybody who multiplies the `unit_price` and `effective_minutes` columns must
 * get the `amount` column back. Computing the amount from the unrounded value
 * would be marginally more accurate and would leave those three columns unable
 * to reproduce each other, which is the property a disputed invoice is checked
 * against. The difference is at most a millionth of a minute of price.
 *
 * Both scales match the columns they land in — `settlements.effective_minutes`
 * is numeric(20,6) and `settlements.amount` is numeric(14,4) — so nothing
 * rounds a second time on the way into Postgres.
 *
 * **The line is not floored, and the round-down decision does not reach here.**
 * A line amount has to be reproducible from the line's own price and minutes,
 * which is the first thing checked when an invoice is disputed, and `floor` of
 * the product is not that product. Flooring here would also charge the loss per
 * line rather than per bill: at 1,200 a minute a 17-second line is `339.9996`,
 * so twenty of them lose 19.992 dong flooring each and 0.992 dong flooring the
 * total once. The floor belongs on the total, in `wholeVnd`.
 */
export function settlementFor(
  unitPrice: string,
  effectiveSecondsS: string,
): { effectiveMinutes: string; amount: string } {
  const seconds = fromDecimal(effectiveSecondsS);
  const effectiveMinutes = quantise(div(seconds, rational(60n)), MINUTES_SCALE);
  const amount = quantise(
    mul(fromDecimal(unitPrice), fromDecimal(effectiveMinutes)),
    MONEY_SCALE,
  );
  return { effectiveMinutes, amount };
}
