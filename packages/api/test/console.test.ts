import { describe, expect, it } from 'vitest';
import { parseCookies, parseRange, safeJoin } from '../src/index.ts';
import { HTML_LANG, LOCALES, MESSAGES, missingKeys, pickLocale, type Locale, type MessageKey } from '../src/i18n.ts';
import { PAYOUT_API_REFUSALS, PAYOUT_REFUSALS } from '../src/payout/routes/payout.ts';

/**
 * The message catalogue and the API's own no-database pieces.
 *
 * Everything here runs at an upload centre with the link down, which is the
 * property the whole service is built around, so none of it may need Postgres
 * to be exercised.
 */

describe('the message catalogue', () => {
  it('holds every key in every locale', () => {
    // A missing Chinese string does not fail loudly at an upload centre — it
    // shows an English word in the middle of a Chinese sentence, which nobody
    // reports as a bug. It should fail here instead.
    for (const locale of LOCALES) expect(missingKeys(locale)).toEqual([]);
  });

  it('has actually been translated, not copied, in every locale', () => {
    /**
     * `app.name` is a product name; everything else being byte-identical to
     * the English means somebody pasted the English in to make the
     * completeness check above pass. Every non-English locale is held to it,
     * so a Vietnamese column added in a hurry is caught the same way a Chinese
     * one would be.
     */
    const sameOnPurpose = new Set<MessageKey>(['app.name']);
    const others = LOCALES.filter((l): l is Exclude<Locale, 'en'> => l !== 'en');
    expect(others.length).toBeGreaterThanOrEqual(2);
    for (const locale of others) {
      const copied = (Object.keys(MESSAGES.en) as MessageKey[]).filter(
        (key) => !sameOnPurpose.has(key) && MESSAGES[locale][key] === MESSAGES.en[key],
      );
      expect(copied, locale).toEqual([]);
    }
  });

  it('names every payout refusal in every locale', () => {
    /**
     * A 409 from a payout route carries a constraint name, and the console
     * turns it into a sentence through `bo.refused.<name>`. A name without a
     * sentence would reach a finance operator as the generic line, which is
     * exactly what an unknown refusal should look like and exactly what a
     * known one must not.
     */
    const names = [...PAYOUT_REFUSALS, ...PAYOUT_API_REFUSALS];
    expect(names.length).toBeGreaterThan(20);
    for (const locale of LOCALES) {
      const missing = names.filter((name) => {
        const value = (MESSAGES[locale] as Record<string, string>)[`bo.refused.${name}`];
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(missing, locale).toEqual([]);
    }
  });

  it('keeps the same placeholders in every locale of every flag sentence', () => {
    // A locale that drops `{episodes}` renders a sentence without the number
    // that caused the flag, which is the one thing the brief forbids.
    const placeholders = (s: string) => [...s.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    const keys = (Object.keys(MESSAGES.en) as MessageKey[]).filter((k) => k.startsWith('risk.signal.'));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      const en = placeholders(MESSAGES.en[key]);
      expect(en.length, key).toBeGreaterThan(0);
      for (const locale of LOCALES) expect(placeholders(MESSAGES[locale][key]), `${locale} ${key}`).toEqual(en);
    }
  });

  it('takes the explicit choice over the browser, and English over nothing', () => {
    // A PaXini reviewer on a shared VNG machine has to be able to switch
    // without touching browser settings.
    expect(pickLocale({ lang: 'zh' }, 'en-GB,en;q=0.9')).toBe('zh');
    expect(pickLocale({}, 'zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(pickLocale({}, 'en-GB,en;q=0.9')).toBe('en');
    expect(pickLocale({ lang: 'vi' }, 'en-GB,en;q=0.9')).toBe('vi');
    expect(pickLocale({}, 'vi-VN,vi;q=0.9,en;q=0.8')).toBe('vi');
    expect(pickLocale({}, undefined)).toBe('en');
    expect(pickLocale({ lang: 'fr' }, undefined)).toBe('en');
    for (const locale of LOCALES) expect(HTML_LANG[locale]).toBeTruthy();
  });
});

describe('range requests', () => {
  it('reads the two forms a media element issues', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('reads a suffix range, which probes use to look for a trailing moov atom', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past the file rather than refusing', () => {
    expect(parseRange('bytes=900-99999', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('calls a range that starts past the end unsatisfiable, not empty', () => {
    // 416, so the client learns the file is shorter than it thought. A 206 of
    // nothing looks like a successful read of no data.
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });

  it('treats an absent or unparseable header as no range at all', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    // Multi-range is deliberately unsupported: no media element issues one, and
    // multipart/byteranges is a lot of untested surface on a serving path.
    expect(parseRange('bytes=0-9,20-29', 1000)).toBeNull();
    expect(parseRange('items=0-9', 1000)).toBeNull();
  });
});

describe('resolving a media path', () => {
  it('joins inside the root', () => {
    expect(safeJoin('/media', 'ego_X_1', 'a.mp4')).toMatch(/ego_X_1/);
  });

  it('refuses anything that climbs out of it', () => {
    // Both components come from the database rather than the request, so this
    // is not the front line — but a stored basename is still data.
    expect(safeJoin('/media', '..', 'etc')).toBeNull();
    expect(safeJoin('/media', 'ego_X_1/../../..', 'passwd')).toBeNull();
    expect(safeJoin('/media', '.')).toBeNull();
  });
});

describe('cookies', () => {
  it('reads the jar a browser sends', () => {
    expect(parseCookies('po_machine=abc; po_operator=def')).toEqual({
      po_machine: 'abc',
      po_operator: 'def',
    });
  });

  it('survives a malformed value rather than throwing on it', () => {
    // A broken cookie should fail signature verification, which is a 401. It
    // should not take the request down before it gets there.
    expect(parseCookies('po_machine=%E0%A4%A')).toEqual({ po_machine: '%E0%A4%A' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('=nothing; ; a=1')).toEqual({ a: '1' });
  });
});
