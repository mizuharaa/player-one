import { describe, expect, it } from 'vitest';
import { e164 } from '../src/phone.ts';

/**
 * The one rule on the sign-in screen with a sharp edge on it. `+840…` matches
 * no collector row and is not a number ZNS will take, so the trunk zero a
 * Vietnamese collector types has to come off before the request goes.
 */
describe('the number the sign-in screen sends', () => {
  it('drops the trunk zero and the separators', () => {
    expect(e164('+84', '0903 000 001')).toBe('+84903000001');
    expect(e164('+84', '903000001')).toBe('+84903000001');
    expect(e164('+86', '138-0000-0000')).toBe('+8613800000000');
  });

  it('never composes a country code followed by a zero', () => {
    for (const typed of ['0900000001', '00900000001', '0 900 000 001']) {
      expect(e164('+84', typed).startsWith('+840')).toBe(false);
    }
  });
});
