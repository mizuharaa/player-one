/**
 * Formatting for quantities a reviewer reads and a collector is paid on.
 *
 * Every function here takes a value the server produced and returns a string.
 * None of them does arithmetic that could reach a payment — the server computes
 * money, and a client that rounded on the way to the screen would be a second
 * rounding site with its own rule.
 */

/**
 * Seconds as `m:ss.mmm`, or `h:mm:ss.mmm` past an hour.
 *
 * Milliseconds are shown because the numbers this formats are PTS-derived and a
 * reviewer comparing a measured duration against a device claim needs to see
 * that they differ by 45.0s and not by "about a minute". Truncated rather than
 * rounded: a playhead that reads 1:04.999 has not reached 1:05, and rounding up
 * would put the displayed position ahead of the frame on screen.
 */
export function duration(seconds: number | string | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = typeof seconds === 'string' ? Number.parseFloat(seconds) : seconds;
  if (!Number.isFinite(total)) return '—';

  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const ms = Math.floor((abs % 1) * 1000);
  const whole = Math.floor(abs);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);

  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
  return `${sign}${h > 0 ? `${h}:` : ''}${mmss}.${String(ms).padStart(3, '0')}`;
}

/** `2:12` — for a column where the milliseconds are noise. */
export function durationShort(seconds: number | string | null | undefined): string {
  const full = duration(seconds);
  return full === '—' ? full : full.slice(0, full.lastIndexOf('.'));
}

/**
 * Money, in the task's currency.
 *
 * `VND` has no minor unit, and `Intl` knows that — which is why the currency
 * code comes from the server with the amount rather than being assumed. The
 * `tasks` table has no currency column yet, so today this is deployment
 * configuration reaching the client through the payload; when the column lands
 * this function does not change.
 */
export function money(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return '—';
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(value);
  } catch {
    /* An unknown ISO code should still print a number, not throw. */
    return `${new Intl.NumberFormat().format(value)} ${currency}`;
  }
}

/** A signed percentage, for the gap between claimed and measured. */
export function signedPercent(claimed: string | null, measured: string): string | null {
  if (claimed === null) return null;
  const c = Number.parseFloat(claimed);
  const m = Number.parseFloat(measured);
  if (!Number.isFinite(c) || !Number.isFinite(m) || m === 0) return null;
  const pct = ((c - m) / m) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

/** A signed duration delta, for the same pair. */
export function signedSeconds(claimed: string | null, measured: string): string | null {
  if (claimed === null) return null;
  const delta = Number.parseFloat(claimed) - Number.parseFloat(measured);
  if (!Number.isFinite(delta)) return null;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`;
}

/** `31.4s` — the pace figure in the top bar. */
export function pace(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  return `${seconds.toFixed(1)}s`;
}
