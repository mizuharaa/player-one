import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  MESSAGES,
  missingKeys,
  type MessageKey,
} from '../src/i18n.ts';

/**
 * The delivery screen's reason map is plain data, but it lives in a screen, so
 * importing it pulls the native modules that screen reaches. Stubbed rather
 * than rendered: this file asserts about the catalogue, not about the UI.
 */
vi.mock('react-native', () => ({ Text: () => null, View: () => null }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  FileMode: {},
  Paths: {},
  UploadType: {},
}));
const { REASON_KEYS } = await import('../src/screens/Uploads.tsx');

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

  /**
   * Every server reason the delivery screen maps, and its sentence in all three
   * languages. `reasonText` prints the server's raw column when the map has no
   * key for a value, so a reason the server can write and this map does not
   * carry is a collector reading `released_by_operator` off a database column.
   */
  it('maps every server reason it can be shown, including a released delivery', () => {
    expect(REASON_KEYS['released_by_operator']).toBe('uploads.reasonReleased');
    for (const key of Object.values(REASON_KEYS)) {
      for (const locale of LOCALES) {
        expect(MESSAGES[locale][key], `${locale} has no sentence for ${key}`).toBeTruthy();
      }
    }
  });
});
