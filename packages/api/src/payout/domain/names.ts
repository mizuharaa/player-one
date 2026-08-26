/**
 * Does the name a collector declared match the name ZaloPay has on file?
 *
 * Pure, and deliberately loose in exactly three ways and no others:
 *
 *   - Diacritics are dropped. `Nguyễn Văn A` and `NGUYEN VAN A` are the same
 *     person: a bank form, a ZaloPay KYC record and a collector's own typing
 *     disagree on tone marks far more often than on the name.
 *   - Whitespace collapses and case folds.
 *   - Tokens are compared as SETS, not sequences. Vietnamese name ordering
 *     varies by form — family-name-first on an ID card, given-name-first on a
 *     western-style form — and `A Van Nguyen` is not a different person from
 *     `Nguyen Van A`.
 *
 * Anything else is a mismatch, and a mismatch is a *signal*, not an error to
 * repair: the caller stores both names and raises a flag. Nothing here ever
 * proposes a correction, and nothing here is fuzzy — one letter off is a
 * different name until a person says otherwise.
 *
 * `đ` is handled by hand: NFD decomposition does not split it, so without the
 * substitution `Đặng` would compare as `đang` against ZaloPay's `Dang`.
 */

export function normaliseName(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .sort();
}

export function namesMatch(declared: string, verified: string): boolean {
  const a = normaliseName(declared);
  const b = normaliseName(verified);
  if (a.length === 0 || a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

/**
 * A phone as it is shown: the last four digits and nothing else. Universal
 * rule 1 of the brief — full identifiers do not go on a screen or in a log.
 */
export function maskPhone(phone: string | null): string {
  if (phone === null || phone === '') return '';
  const digits = phone.replace(/\D/g, '');
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
