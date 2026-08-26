import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  MESSAGES,
  missingKeys,
  type MessageKey,
} from '../src/i18n.ts';

/**
 * The collector app's catalogue, held to the same standard as the console's
 * (packages/api/test/console.test.ts): every key in every locale, and the
 * second locale actually translated rather than pasted.
 */
describe('the collector message catalogue', () => {
  it('is Vietnamese first', () => {
    // LOC-01 is P0: the collector app is in Vietnamese. English rides along
    // at P2. If this ever flips, someone changed the product's audience.
    expect(DEFAULT_LOCALE).toBe('vi');
    expect(LOCALES[0]).toBe('vi');
  });

  it('holds every key in every locale', () => {
    for (const locale of LOCALES) expect(missingKeys(locale)).toEqual([]);
  });

  it('has actually been translated, not copied', () => {
    // `app.name` is the product name and `prov.rssi` a technical initialism,
    // the same in both languages. Everything else byte-identical means the
    // English was pasted in to pass the check above.
    const sameOnPurpose = new Set<MessageKey>(['app.name', 'prov.rssi']);
    const copied = (Object.keys(MESSAGES.vi) as MessageKey[]).filter(
      (key) => !sameOnPurpose.has(key) && MESSAGES.en[key] === MESSAGES.vi[key],
    );
    expect(copied).toEqual([]);
  });
});
