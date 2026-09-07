/**
 * The number the sign-in screen sends, composed from the country code the
 * collector picked and the digits they typed.
 *
 * Its own module and not a closure inside the screen, so the one rule with a
 * sharp edge on it — the leading zero — can be checked without mounting React
 * Native (`test/phone.test.ts`).
 *
 * `zns.ts` on the server normalises both `+84…` and `0…` spellings before it
 * talks to ZNS, so E.164 is safe to send; what is *not* safe is `+840…`, which
 * is neither spelling and matches no collector row. A Vietnamese collector
 * types their number the way it is written on their phone — `0903…` — so the
 * zero arrives here on almost every sign-in. It is stripped for +86 as well,
 * for the same reason and not a different one: a country code followed by a
 * trunk zero is not a number in either country.
 */
export function e164(countryCode: string, typed: string): string {
  const digits = typed.replace(/\D/g, '').replace(/^0+/, '');
  return `${countryCode}${digits}`;
}
