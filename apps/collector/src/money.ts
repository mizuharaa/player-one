import type { IncomeEntry } from './api/types.ts';

/**
 * Printing a figure the server sent. The app's only contact with a money
 * string, deliberately in a file with no React and no react-native in it so
 * that the property it guarantees can be tested without a DOM.
 */

/**
 * The server's decimal string, printed the way Vietnamese writes money.
 *
 * **This does no arithmetic and must never start.** `quantise` in
 * `packages/api/src/money.ts` is the one rounding site in the system and it
 * hands this app a string at `MONEY_SCALE` (four decimals) — `960000.0000`.
 * What happens below is two string operations and nothing else: a fractional
 * part that is all zeros is dropped, and the integer part is grouped in threes
 * with a full stop. No addition, no multiplication, no `parseFloat`; the
 * digits that come out are the digits that came in, in the same order.
 *
 * It exists because the alternative breaks a screenshot rather than because it
 * is desirable: `960000.0000 ₫` at `fontSize.3xl` is fourteen characters on a
 * line §0.3 measured at about sixteen, and it clips at 360dp. The honest fix is
 * for `/api/me/income` to send a display-ready string, since §14.1 says the app
 * "renders them and adds nothing" — until it does, the rendering half lives
 * here, in one function, with a test.
 *
 * A non-zero fraction is kept verbatim. A figure the server sent with real
 * centimes is not this function's to round away.
 */
export function vnd(value: string): string {
  const [whole = '', fraction] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign === '' ? whole : whole.slice(1);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const keep = fraction === undefined || /^0*$/.test(fraction) ? '' : `,${fraction}`;
  return `${sign}${grouped}${keep}`;
}

/** The same figure with the currency glyph the app prints beside it. */
export const dong = (value: string): string => `${vnd(value)} ₫`;


/**
 * A measured quantity the server sent, printed without its trailing zeros.
 *
 * `effective_minutes` arrives at the column's scale — `27.000000` — and
 * "Phút hiệu quả · 27.000000" is six digits of false precision on the one
 * figure a collector multiplies in their head to check a payment. Same two
 * string rules as `vnd` and the same guarantee: a fraction that is all zeros
 * is dropped and nothing else is touched. No grouping, because a minute count
 * is small and a thousands separator on it would read as a decimal point.
 */
export function quantity(value: string): string {
  const [whole = '', fraction] = value.split('.');
  return fraction === undefined || /^0*$/.test(fraction) ? whole : `${whole},${fraction}`;
}

/**
 * An episode id, shortened for a row (SPEC §14).
 *
 * Display only, and the tail rather than the head: these are UUIDs whose first
 * four groups are identical across a seeded demo, so the front is the half
 * that identifies nothing. A shorter id is never sent anywhere and never
 * compared — every request carries the whole one.
 */
export const shortId = (id: string): string => (id.length <= 12 ? id : `…${id.slice(-8)}`);

/**
 * A byte count, in gigabytes and one decimal.
 *
 * Display only, like everything else in this file, and the same rule applies:
 * this is a size, not a figure anybody is paid on. It rounds — 12.44 GB and
 * 12.35 GB both print `12.4 GB` — because a collector reading a free-space
 * line or an upload total needs the magnitude and not the byte.
 */
export const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** A review decision includes rejection; only the server decides payability. */
export function incomeStatus(entry: IncomeEntry | undefined, reviewFailed = false) {
  if (reviewFailed || entry?.settlementState === 'not_paid') return 'settlement.not_paid';
  if (entry?.settlementState === 'cannot_be_paid') return 'settlement.cannot_be_paid';
  return entry?.kind === 'confirmed' ? 'income.confirmed' : 'income.estimated';
}


/** Green is evidence of a positive live payment, never a rate or a reviewed estimate. */
export function isLivePaid(entry: IncomeEntry | undefined, reviewFailed = false): boolean {
  const amount = entry?.amountVnd ?? '';
  return !reviewFailed && entry?.kind === 'confirmed' && entry.simulation === false
    && (entry.settlementState === 'paid' || entry.settlementState === 'manually_paid')
    && /^\d+(?:\.\d+)?$/.test(amount) && /[1-9]/.test(amount);
}
