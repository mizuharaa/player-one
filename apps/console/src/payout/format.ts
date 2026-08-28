/**
 * Formatting for the payout screens. Every function takes a value the server
 * produced and returns a string; none of them adds, multiplies or rounds a
 * figure that reaches a payment. The one place a number is handed to `Intl`
 * is `vnd`, and what goes in is a whole number of dong the database already
 * decided on.
 */

/** The BCP 47 tag for each catalogue locale, for `Intl` and for `lang`. */
export const LOCALE_TAG: Record<string, string> = { en: 'en', zh: 'zh-Hans', vi: 'vi' };

const tag = (locale: string): string => LOCALE_TAG[locale] ?? 'en';

/**
 * Whole dong, as currency. `VND` has no minor unit and `Intl` knows it, so a
 * bigint of dong prints without a decimal point in every locale. `null` is
 * "there is no whole-dong figure", which is a state the screen names rather
 * than a zero.
 */
export function vnd(amount: number | null | undefined, locale: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(tag(locale), {
      style: 'currency',
      currency: 'VND',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} VND`;
  }
}

/** A stored decimal string, shown as stored. The exact figure, mono, never reformatted. */
export function asStored(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : value;
}

/** A count. Not money; a number of rows, flags or transfers. */
export function count(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(tag(locale)).format(n);
}

/** An instant, in the reader's locale, to the minute. */
export function when(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** A day, for a period boundary. Periods start at midnight UTC and are shown as UTC days so two operators in two zones read the same date. */
export function day(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/**
 * How long ago, coarsely: `3d 4h`, `2h 15m`, `40m`. For an attempt that is
 * still being polled, where the question is "how long has this been open".
 * Time, not money.
 */
export function elapsed(sinceIso: string | null | undefined, now: number = Date.now()): string {
  if (!sinceIso) return '—';
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return '—';
  const spanMin = Math.max(0, Math.floor((now - since) / 60_000));
  const d = Math.floor(spanMin / 1440);
  const h = Math.floor((spanMin % 1440) / 60);
  const m = spanMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
