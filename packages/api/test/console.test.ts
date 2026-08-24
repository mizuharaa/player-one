import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCookies, parseRange, safeJoin } from '../src/index.ts';
import { LOCALES, MESSAGES, missingKeys, pickLocale, type MessageKey } from '../src/i18n.ts';
import { BASE_CSS, escapeHtml, escapeJson, page } from '../src/shell.ts';

/**
 * The console's own pieces, tested without a database.
 *
 * Everything here runs at an upload centre with the link down, which is the
 * property the whole service is built around, so none of it may need Postgres
 * to be exercised.
 */

const ASSETS = join(import.meta.dirname, '..', 'assets');

describe('the message catalogue', () => {
  it('holds every key in every locale', () => {
    // A missing Chinese string does not fail loudly at an upload centre — it
    // shows an English word in the middle of a Chinese sentence, which nobody
    // reports as a bug. It should fail here instead.
    for (const locale of LOCALES) expect(missingKeys(locale)).toEqual([]);
  });

  it('has actually been translated, not copied', () => {
    /**
     * `app.name` is a product name and `player.of` is a separator; everything
     * else being byte-identical to the English means somebody pasted the
     * English in to make the completeness check above pass.
     */
    const sameOnPurpose = new Set<MessageKey>(['app.name']);
    const copied = (Object.keys(MESSAGES.en) as MessageKey[]).filter(
      (key) => !sameOnPurpose.has(key) && MESSAGES.zh[key] === MESSAGES.en[key],
    );
    expect(copied).toEqual([]);
  });

  it('takes the explicit choice over the browser, and English over nothing', () => {
    // A PaXini reviewer on a shared VNG machine has to be able to switch
    // without touching browser settings.
    expect(pickLocale({ lang: 'zh' }, 'en-GB,en;q=0.9')).toBe('zh');
    expect(pickLocale({}, 'zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(pickLocale({}, 'en-GB,en;q=0.9')).toBe('en');
    expect(pickLocale({}, undefined)).toBe('en');
    expect(pickLocale({ lang: 'fr' }, undefined)).toBe('en');
  });
});

describe('escaping', () => {
  it('escapes text that came from a person at a counter', () => {
    // "It came from Postgres" is not the same claim as "it is safe in markup":
    // collector references and task names are typed by hand.
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });

  it('breaks up sequences that would end a script element early', () => {
    expect(escapeJson({ a: '</script>' })).not.toContain('</script>');
    // U+2028 is legal in JSON and a line terminator in JavaScript source.
    expect(escapeJson({ a: ' ' })).toBe('{"a":"\\u2028"}');
  });
});

describe('the page skeleton', () => {
  const html = page({ locale: 'zh', title: 'x', body: '<p>y</p>', module: '/m.js', data: { a: 1 } });

  it('declares the document language, so a screen reader does not read Chinese as English', () => {
    expect(html).toContain('lang="zh-Hans"');
  });

  it('asks for nothing from the internet', () => {
    // Upload centres run on a LAN and the service is built to work with the
    // link down. A webfont or a CDN script would make the console's appearance
    // depend on a dependency nothing else in the system has.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('carries its bootstrap data as JSON rather than as script', () => {
    expect(html).toContain('<script type="application/json" id="bootstrap">');
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

describe('the client module', () => {
  it('never turns on native video controls', async () => {
    // Native controls take keyboard focus and would swallow space, the arrows
    // and every letter binding on a screen that is meant to be driven from the
    // keyboard. This is the reason the scrub bar is hand-built.
    const [js, html] = await Promise.all([
      readFile(join(ASSETS, 'review.js'), 'utf8'),
      readFile(join(import.meta.dirname, '..', 'src', 'console.ts'), 'utf8'),
    ]);
    expect(js).not.toMatch(/\.controls\s*=\s*true/);
    expect(html).not.toMatch(/<video[^>]*\scontrols/);
  });

  it('handles every key the shortcut overlay advertises', async () => {
    const [js, markup] = await Promise.all([
      readFile(join(ASSETS, 'review.js'), 'utf8'),
      readFile(join(import.meta.dirname, '..', 'src', 'console.ts'), 'utf8'),
    ]);
    // The overlay is the contract with the reviewer. A binding that is
    // documented and not handled is worse than one that is neither.
    const advertised = [
      ["' '", /case ' ':/],
      ['ArrowLeft', /case 'ArrowLeft':/],
      ['ArrowRight', /case 'ArrowRight':/],
      ['j / l', /case 'j':[\s\S]*case 'l':/],
      ['i', /case 'i':/],
      ['o', /case 'o':/],
      ['x', /case 'x':/],
      ['1 / 2 / 3', /case '1':[\s\S]*case '2':[\s\S]*case '3':/],
      ['Enter', /case 'Enter':/],
      ['?', /case '\?':/],
    ] as const;
    for (const [name, pattern] of advertised) {
      expect(pattern.test(js), `no handler for ${name}`).toBe(true);
    }
    for (const legend of ['J', 'L', 'I', 'O', 'X', '1', '2', '3']) {
      expect(markup).toContain(`<span class="kbd">${legend}</span>`);
    }
  });

  it('suppresses shortcuts while focus is in a text field', async () => {
    // A reviewer typing "1 in 3 frames are dark" into the note must not set
    // three verdicts on the way through.
    const js = await readFile(join(ASSETS, 'review.js'), 'utf8');
    expect(js).toMatch(/if \(typing\(event\.target\)\)/);
    expect(js).toMatch(/tagName === 'INPUT'/);
  });

  it('keeps speech intelligible at speed', async () => {
    // Most reviewing happens at 2×, and without pitch correction the audio at
    // that rate cannot be judged at all.
    const js = await readFile(join(ASSETS, 'review.js'), 'utf8');
    expect(js).toMatch(/preservesPitch = true/);
  });

  it('asks for nothing from the internet', async () => {
    const [js, css] = await Promise.all([
      readFile(join(ASSETS, 'review.js'), 'utf8'),
      readFile(join(ASSETS, 'review.css'), 'utf8'),
    ]);
    expect(js).not.toMatch(/https?:\/\/(?!\s)/);
    expect(css).not.toMatch(/@import|https?:\/\//);
  });

  it('takes no colour that is not a token', async () => {
    /**
     * The design system is only a system while this holds: every literal colour
     * lives in `:root` and everything else reads it through `var()`.
     * `color-mix` is allowed because its input is a token; a raw hex anywhere
     * else is a near-miss grey that the next screen will copy.
     */
    const css = await readFile(join(ASSETS, 'review.css'), 'utf8');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);

    // The shared primitives too — the token block is the one place values live,
    // and BASE_CSS sits right underneath it where a literal is easy to slip in.
    expect(BASE_CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(BASE_CSS.match(/\brgba?\(/g) ?? []).toEqual([]);
  });
});
