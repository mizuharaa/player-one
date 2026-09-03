import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESSAGES, type MessageKey } from '@playerone/api/i18n';

/**
 * The two rules the console's source has to keep, checked by reading it.
 *
 * Neither can be caught by a typecheck and neither shows up in a screenshot
 * taken in the language it was written in. They are the two ways this surface
 * quietly stops being one product:
 *
 * **A sentence written into a `.tsx` file has no Chinese.** LOC-02 puts the
 * back office in front of PaXini's reviewers in Shenzhen, and the catalogue in
 * `packages/api/src/i18n.ts` fails a build when an English key arrives without
 * its Chinese counterpart — but only for strings that go through it at all. A
 * literal skips that check entirely, and the symptom is an English paragraph in
 * the middle of a Chinese screen, which nobody files as a bug.
 *
 * **A colour written into a `.tsx` file has no collector app.** The tokens are
 * authored once in `packages/design` and consumed by the console, the Electron
 * upload-centre client and React Native, which has no cascade and no `var()`.
 * A value that exists only here is a value two of those three cannot have.
 *
 * This runs with no database and no browser, because everything it needs is on
 * disk.
 */

const SRC = join(import.meta.dirname, '..', 'src');

async function sources(dir: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(full)));
    else if (extname(entry.name) === '.tsx' || extname(entry.name) === '.ts') {
      out.push({ path: full.slice(SRC.length + 1).replaceAll('\\', '/'), text: await readFile(full, 'utf8') });
    }
  }
  return out;
}

const FILES = await sources(SRC);

/** The first segment of every key the catalogue holds: `app`, `login`, … */
const NAMESPACES = new Set(Object.keys(MESSAGES.en).map((k) => k.split('.')[0]!));
const text = (path: string) => FILES.find((f) => f.path === path)?.text ?? '';

/**
 * Comments are prose about the code and are allowed to quote a string. Only
 * what the browser can render is being checked here.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A user-facing string written straight into an attribute.
 *
 * Declared once and shared by the rule and by the test that proves the rule
 * bites, because the two drifting apart is exactly how this check died before.
 */
const ATTRIBUTE_LABEL = /\b(aria-label|title|placeholder|alt)="([^"]+)"/;

/**
 * A call into the catalogue, in either quote style and with or without options.
 *
 * Global, because both the rule and the test that proves the rule bites iterate
 * it — and shared for the same reason `ATTRIBUTE_LABEL` is: the two drifting
 * apart is how the last one of these stopped working.
 */
const CATALOGUE_CALL = /\bt\((['"`])([a-z][\w.]+)\1/g;

/**
 * A string that is shaped like a catalogue key, wherever it is written.
 *
 * The call pattern above only sees `t('key')`. Half of this console does not
 * write its keys that way: `PillNav` holds them in a `DESTINATIONS` table and
 * calls `t(key)`; `Pipeline` holds three of them per row. A key that never
 * appears inside a `t(` therefore escaped every check here, and a missing
 * catalogue row renders as its own name — `pipeline.cap.bill`, printed on the
 * page, in both languages.
 *
 * Two dotted lowercase segments is the shape, which is narrow enough not to
 * catch a class name, a URL path or a file name, and it is judged only against
 * namespaces the catalogue already uses.
 */
const KEY_SHAPED = /(['"`])([a-z][a-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,3})\1/g;

/**
 * A `t()` call whose key this file cannot read: a template literal, or a
 * concatenation. Banned outright rather than parsed, because the alternative is
 * a scanner that has to evaluate an expression to know what it asked for.
 * `Pipeline` had one and its five state words were invisible until they were
 * written out as literals.
 */
const COMPUTED_CALL = /\bt\((?:\s*`|[^()]*\+)/;

describe('every sentence on a screen comes from the catalogue', () => {
  /**
   * Each of these was a literal in the file named beside it, and each of them
   * rendered in English on a screen a reviewer had switched to Chinese. They
   * are listed by their exact words rather than by a heuristic because a
   * heuristic that scans for "English-looking text" also finds `PlayerOne`,
   * `AZER76400FE` and `UPL-14`, all of which are correct as they stand.
   */
  const MOVED: [file: string, sentence: string, key: MessageKey][] = [
    ['routes/Home.tsx', 'Effective duration from decided reviews only.', 'home.payable.note'],
    ['routes/Home.tsx', 'Passes and partial passes, against every decision today.', 'home.approval.note'],
    ['routes/Home.tsx', 'Your decisions only. Not the programme', 'home.settled.note'],
    ['routes/Home.tsx', 'Load to verdict. Instrumentation, never money.', 'home.average.note'],
    ['routes/Home.tsx', 'The shift figures did not load', 'home.figuresFailed.title'],
    ['routes/Home.tsx', 'episodes reviewed', 'home.reviewed'],
    ['routes/Login.tsx', 'Every recorded hour gets an owner', 'login.promise'],
    ['routes/Login.tsx', 'Footage stays in Vietnam', 'login.partners'],
    ['routes/Login.tsx', 'The service did not answer', 'login.network'],
    ['routes/Pipeline.tsx', 'Hand in card', 'pipeline.stage.handover'],
    ['routes/Pipeline.tsx', 'Cloud upload', 'pipeline.stage.upload'],
    ['routes/Pipeline.tsx', 'Duration measurement', 'pipeline.cap.duration'],
    ['routes/Pipeline.tsx', 'Raw or proxy playback for review', 'pipeline.cap.playback'],
    ['routes/Pipeline.tsx', 'Android app', 'pipeline.surface.app'],
    ['routes/Pipeline.tsx', 'D1 (Wi-Fi protocol)', 'pipeline.footnote'],
    ['routes/Review.tsx', "['Space',", 'shortcuts.spaceKey'],
    ['routes/Review.tsx', 'onStage>Space<', 'shortcuts.spaceKey'],
  ];

  it.each(MOVED)('%s does not print %j itself', (file, sentence, key) => {
    expect(withoutComments(text(file))).not.toContain(sentence);
    // And the words did not simply vanish: the catalogue is where they went.
    expect(MESSAGES.en[key]).toBeTruthy();
    expect(MESSAGES.zh[key]).toBeTruthy();
  });

  /**
   * The same rule, for the strings only a screen reader ever hears.
   *
   * These are the easiest ones to leave in English, because switching the
   * console to Chinese does not visibly change anything about them — a
   * reviewer using a screen reader in Chinese is the only person who finds
   * out, and they are the person least able to work around it.
   */
  it('names every control from the catalogue too', () => {
    const offenders: string[] = [];
    for (const { path, text: source } of FILES) {
      for (const [, attribute, value] of withoutComments(source).matchAll(
        new RegExp(ATTRIBUTE_LABEL, 'g'),
      )) {
        /** The product's own name is the same word in both locales. */
        if (value === 'PlayerOne') continue;
        offenders.push(`${path}: ${attribute}="${value}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The rule above, proving it can still fail.
   *
   * It could not, for one commit: the pattern was written through a shell
   * heredoc and the word-boundary escape arrived as a literal U+0008 BACKSPACE,
   * so it matched no real attribute and passed over every hard-coded English
   * label in the tree. A rule with no offender to catch is indistinguishable
   * from a rule that works.
   */
  it('would catch a hard-coded label if one appeared', () => {
    expect(ATTRIBUTE_LABEL.test('<nav aria-label="Sections">')).toBe(true);
    expect(ATTRIBUTE_LABEL.test("<nav aria-label={t('nav.sections')}>")).toBe(false);
  });

  it('asks for no key the catalogue does not hold', () => {
    /**
     * The other half of the same guarantee. A screen may only name a key that
     * exists in both locales — `t('home.payable.note')` against a catalogue
     * that never gained it renders the key itself, which is worse than English.
     */
    const missing = new Set<string>();
    for (const { text: source } of FILES) {
      for (const [, , key] of source.matchAll(CATALOGUE_CALL)) {
        if (!(key in MESSAGES.en)) missing.add(key!);
      }
    }
    expect([...missing]).toEqual([]);
  });

  /**
   * The rule above, proving it reads more than one way of writing a call.
   *
   * It was `/\bt\('([a-z][\w.]+)'\)/`, which required a single-quoted key and a
   * closing bracket immediately after it — so `t("nav.home")` and
   * `t('lease.held', { minutes })` were both invisible to it, and a key that
   * does not exist written either of those ways renders as its own name on the
   * screen. The pattern now stops at the key, whatever follows.
   */
  it('reads a catalogue key however the call is written', () => {
    const keys = (source: string) => [...source.matchAll(CATALOGUE_CALL)].map((m) => m[2]);
    expect(keys("t('nav.home')")).toEqual(['nav.home']);
    expect(keys('t("nav.home")')).toEqual(['nav.home']);
    expect(keys("t('lease.held', { minutes })")).toEqual(['lease.held']);
    /** Not every `t(` is the catalogue: a local `format(t)` must not match. */
    expect(keys('format(t, x)')).toEqual([]);
  });

  /**
   * The half the call pattern cannot see.
   *
   * A key written into a table and read back with `t(key)` is still a key this
   * console asks the catalogue for, and nothing checked those at all: the scan
   * proved something about `t('...')` and was described as proving something
   * about the console. `PillNav`, `Pipeline` and `Cu` all keep keys in tables.
   */
  it('holds no catalogue-shaped string the catalogue does not have', () => {
    const missing = new Set<string>();
    for (const { text: source } of FILES) {
      for (const [, , key] of withoutComments(source).matchAll(KEY_SHAPED)) {
        const namespace = key!.split('.')[0]!;
        if (NAMESPACES.has(namespace) && !(key! in MESSAGES.en)) missing.add(key!);
      }
    }
    expect([...missing]).toEqual([]);
  });

  /**
   * And the rule that keeps both scans complete.
   *
   * Both read source text, so a key the source computes is a key neither can
   * see. There is exactly one way to write a key on this surface: as a literal,
   * either inside the call or in a table the call reads.
   */
  it('computes no catalogue key', () => {
    const offenders = FILES.filter((f) => COMPUTED_CALL.test(withoutComments(f.text))).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it('would catch a computed key if one appeared', () => {
    expect(COMPUTED_CALL.test('t(`pipeline.state.${row.state}`)')).toBe(true);
    expect(COMPUTED_CALL.test("t('pipeline.state.' + row.state)")).toBe(true);
    expect(COMPUTED_CALL.test("t('pipeline.state.built')")).toBe(false);
    /** A table read is allowed: `KEY_SHAPED` above is what covers it. */
    expect(COMPUTED_CALL.test('t(stage.key)')).toBe(false);
  });
});

describe('every colour, radius and shadow comes from the tokens', () => {
  /**
   * `Cu.tsx` is included deliberately. Her coat was the last set of hex values
   * in this tree, and DESIGN.md says the same artwork ships again as an
   * `react-native-svg` component — so it is exactly the case the rule exists
   * for, not an exception to it.
   */
  const BANNED: [name: string, pattern: RegExp][] = [
    ['a hex colour', /#[0-9a-fA-F]{3,8}\b/],
    ['an rgb() or rgba() literal', /\brgba?\(/],
    ['a Tailwind palette colour', /\b(?:bg|text|border|fill|stroke|ring|shadow|accent|caret|decoration)-(?:white|black|red|green|blue|amber|slate|gray|grey|zinc|neutral|stone|orange|yellow|violet|purple|indigo|rose|teal|cyan|emerald|lime|sky|fuchsia|pink)\b/],
    ['a bare CSS colour keyword', /\b(?:color-mix|background|fill|stroke)[^\n]*[,(\s](?:white|black)\b/],
    ['a pixel radius or shadow', /(?:rounded|shadow|ring)-\[[0-9]/],
  ];

  it.each(BANNED)('no .tsx file carries %s', (_name, pattern) => {
    const offenders = FILES.filter(
      (f) => f.path.endsWith('.tsx') && pattern.test(withoutComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
