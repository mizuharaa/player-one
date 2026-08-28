/**
 * The settlement period, as the screens carry it.
 *
 * A period is named by its start day, `YYYY-MM-DD`, and travels in the URL
 * (`?period=2026-08-17`) so a link to a batch opens the same batch for
 * whoever follows it. The API takes that string as `:period` and derives the
 * end from the settlement cycle (`PLAYERONE_SETTLEMENT_CYCLE_DAYS`, weekly
 * `[ASSUMED]`), the same rule `settle.ts` applies — the console never
 * computes a period end.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * The Monday of the current UTC week. The seed and the fixtures bill Monday
 * to Monday, and a screen that opened on an empty Thursday would look like
 * nobody had been paid.
 */
export function defaultPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The search-param validator every settle screen shares. */
export function periodSearch(search: Record<string, unknown>): { period: string } {
  return { period: isPeriod(search['period']) ? search['period'] : defaultPeriod() };
}

/** The flag-review screen adds the bill to open. */
export function riskSearch(search: Record<string, unknown>): { period: string; bill?: string } {
  const bill = search['bill'];
  return {
    ...periodSearch(search),
    ...(typeof bill === 'string' && bill !== '' ? { bill } : {}),
  };
}

/** Query keys, in one place, so an invalidation after a payment reaches every screen. */
export const keys = {
  batch: (period: string) => ['payout', 'batch', period] as const,
  preflight: (period: string) => ['payout', 'preflight', period] as const,
  income: (collectorId: string) => ['payout', 'income', collectorId] as const,
  attempt: (id: string) => ['payout', 'attempt', id] as const,
  holds: (billId: string) => ['risk', 'holds', billId] as const,
  role: ['payout', 'role'] as const,
};
