/**
 * The inspection round: every screen, both viewports, both themes, both
 * languages, into a fresh directory under `.impeccable/review/`.
 *
 * Not a test, but it has to be able to fail. A screenshot runner that exits 0
 * having photographed the sign-in page forty times is worse than no runner at
 * all, because the PNGs look like evidence. So every shot asserts three things
 * before the file is written — the browser is on the route that was asked for,
 * a landmark that only that screen has is on the page, and nothing errored
 * while it rendered — and any shot that cannot say all three is named at the
 * end and sets a non-zero exit code.
 *
 *   DATABASE_URL=<throwaway> node packages/api/scripts/seed-console.mjs
 *   CONSOLE_URL=http://localhost:5173 node apps/console/scripts/shots.mjs
 *
 * `CONSOLE_URL` is required and must be loopback. This signs in and claims
 * review leases, which are writes, so it will not guess which console it is
 * pointed at — and because the address of a console says nothing about which
 * database is behind it, the seed run leaves a one-off operator name in
 * `.impeccable/shots-target.json` and this round signs in as that. Only the
 * database `seed-console.mjs` just truncated has it, which is the check that
 * happens at the API rather than at the address bar.
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Named, never defaulted.
 *
 * There is no safe default here. This round signs in and claims real review
 * leases, and a developer machine can be running more than one console — a
 * silent `http://localhost:5173` fallback took a lease out of a queue that
 * belonged to a different worktree, which is exactly the failure the loopback
 * check cannot see, because the wrong console is loopback too.
 */
const BASE = process.env.CONSOLE_URL;
if (!BASE) {
  console.error('CONSOLE_URL is required, e.g. CONSOLE_URL=http://localhost:5173');
  console.error('This round signs in and claims review leases; it will not guess which console.');
  process.exit(2);
}

/**
 * Loopback only, and checked rather than trusted.
 *
 * The round signs in and claims episodes. Pointed at a staging or production
 * console by a stale environment variable it would take real leases out of a
 * real queue, and the reviewer whose episode vanished would have no way to know
 * why.
 */
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];
const host = new URL(BASE).hostname;
if (!LOOPBACK.includes(host)) {
  console.error(`CONSOLE_URL must be loopback; got ${host}. This round signs in and claims leases.`);
  process.exit(2);
}

/**
 * The browser URL is not the whole answer: Vite proxies `/api` to whatever
 * `PLAYERONE_API` names, so a loopback console can still be a window onto a
 * remote API. When that variable is set here it is checked too. When it is not,
 * the proxy default is loopback and there is nothing to check.
 */
const api = process.env.PLAYERONE_API;
if (api && !LOOPBACK.includes(new URL(api).hostname)) {
  console.error(`PLAYERONE_API must be loopback; got ${new URL(api).hostname}.`);
  process.exit(2);
}

/**
 * The backend has to prove it is the throwaway one, at the API.
 *
 * The two checks above are about addresses, and an address proves nothing here:
 * Vite proxies `/api` to whatever `PLAYERONE_API` names, so a loopback console
 * can be a window onto a remote API, and `PLAYERONE_API` unset only means the
 * *default* proxy target is loopback — the API listening there is still
 * whatever database somebody last pointed `pnpm serve` at.
 *
 * So the round signs in as an operator that only one database has:
 * `seed-console.mjs` truncates, seeds, and writes the name it minted into
 * `.impeccable/shots-target.json`. A round pointed at any other backend cannot
 * authenticate at all, and the sign-in failure below is deliberately fatal.
 * This is the identity assertion happening where the writes happen.
 */
const TARGET = join(import.meta.dirname, '..', '..', '..', '.impeccable', 'shots-target.json');
let target;
try {
  target = JSON.parse(await readFile(TARGET, 'utf8'));
} catch {
  console.error(`no ${TARGET}. Run:  DATABASE_URL=<throwaway> node packages/api/scripts/seed-console.mjs`);
  console.error('This round signs in and claims review leases; it only runs against a database it seeded.');
  process.exit(2);
}
if (typeof target.external_ref !== 'string' || !target.external_ref.startsWith('op-shots-')) {
  console.error(`${TARGET} does not name a seeded screenshot operator.`);
  process.exit(2);
}

/**
 * A new directory every run, so a before/after pair cannot destroy itself.
 * `SHOTS_OUT` names one explicitly when a comparison wants stable paths.
 */
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const OUT = process.env.SHOTS_OUT ?? `.impeccable/review/${stamp}`;
await mkdir(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/**
 * One landmark per screen that no other screen has.
 *
 * `/review` accepts either the theatre or an empty-queue heading, because both
 * are correct answers from a seeded queue that a previous shot has drained —
 * and both are still unmistakably the review screen rather than a sign-in form
 * or a router error page.
 */
const SCREENS = {
  login: { path: '/login', landmark: 'input[name="machine_identifier"]' },
  home: { path: '/', landmark: 'figure[role="img"]' },
  /**
   * A `<video>` with a source, or the empty-queue heading — never the bare
   * theatre. `section.on-stage` is on the page whether or not an episode
   * arrived, so accepting it accepted a black rectangle as a review screen.
   */
  review: { path: '/review', landmark: 'video[src], main h2' },
  pipeline: { path: '/pipeline', landmark: 'main table' },
  counter: { path: '/counter', landmark: 'main h1' },
  episodes: { path: '/episodes', landmark: 'main h1' },
  settle: { path: '/settle', landmark: 'main h1' },
};

/**
 * The one console error this console is expected to produce.
 *
 * The router probes `/whoami` before sign-in and the browser logs the 401 as a
 * failed resource. The **url** is what is matched, not the message: Chrome's
 * console text is only "Failed to load resource: the server responded with a
 * status of 401 (Unauthorized)" and names no resource at all, so matching on
 * the text allowed every 401 — including an expired session on
 * `/api/review/claim`, which presents as an empty queue. Everything else — a
 * 500, a broken image, an uncaught exception, a React warning — means the PNG
 * about to be written is a picture of something wrong, and is fatal.
 */
const SESSION_PROBE = '/whoami';
const isSessionProbe = (message) =>
  /401/.test(message.text()) && new URL(message.location()?.url ?? BASE).pathname === SESSION_PROBE;

/**
 * The rule above, proving it can still say yes and still say no.
 *
 * It could not say yes, for one commit. The pattern was written through a shell
 * heredoc and its word-boundary escape arrived as a literal U+0008 BACKSPACE,
 * so it read as "/whoami" followed by a control character and matched no URL
 * that has ever existed. Every shot in every round was therefore fatal and the
 * runner could not go green against a healthy console — the failure mode that
 * looks like a strict tool and is really a broken one.
 *
 * That is the same defect, in a second file, that killed the attribute check in
 * `apps/console/test/screens.test.ts`. Both now carry an offender they have to
 * catch and a case they have to clear, because a rule with neither is
 * indistinguishable from a rule that does not run.
 */
for (const [url, expected] of [
  [`${BASE}/whoami`, true],
  [`${BASE}/api/review/claim`, false],
  [`${BASE}/whoami/nested`, false],
]) {
  const got = isSessionProbe({
    text: () => 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
    location: () => ({ url }),
  });
  if (got !== expected) {
    console.error(`the 401 filter is broken: ${url} read as ${got}, expected ${expected}`);
    process.exit(2);
  }
}

/**
 * Two Latin words in a row, which is what an untranslated sentence looks like.
 *
 * Deliberately not "any Latin letters": the review rail prints device serials,
 * session folder names and requirement ids, `PillNav` prints `PlayerOne`, and
 * the pipeline table prints `UPL-14`. Every one of those is a single token and
 * every one of them is correct as it stands — the brief prints requirement ids
 * that way in every language. Two words is the shape of a sentence.
 */
const ENGLISH_SENTENCE = /[A-Za-z]{3,}[\s\u00a0]+[A-Za-z]{3,}/;

const browser = await chromium.launch();

async function shoot(name, { viewport, theme, locale, screen }) {
  const { path, landmark } = SCREENS[screen];
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: locale === 'zh' ? 'zh-CN' : 'en-US',
  });
  const page = await context.newPage();

  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !isSessionProbe(m)) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`uncaught: ${e}`));
  /**
   * A request the browser cancelled is not a defect.
   *
   * `net::ERR_ABORTED` is what a navigation away, an unmounted component and a
   * `<video>` whose `src` changed all produce, and this round navigates to
   * `about:blank` on purpose to release the review lease. Everything else — a
   * refused connection, a DNS failure, a TLS error — means the screen was
   * missing something while it was photographed.
   */
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? 'unknown';
    if (why !== 'net::ERR_ABORTED') problems.push(`request failed (${why}): ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} from ${r.url()}`);
  });

  /**
   * Everything from here is inside `try`, because the `finally` is the part
   * that matters: a shot that throws halfway still holds a review lease, and
   * leaving it held locks an episode out of the queue for the whole lease
   * window — so the next shot photographs an empty queue and blames itself.
   * Navigating to `about:blank` fires `pagehide`, which is how the review
   * screen releases; closing the context without it does not.
   */
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([t, l]) => {
        if (t === 'system') localStorage.removeItem('playerone.theme');
        else localStorage.setItem('playerone.theme', t);
        localStorage.setItem('playerone.locale', l);
      },
      [theme, locale],
    );

  /**
   * Sign in, unless the sign-in screen is the subject.
   *
   * The failure is deliberately not caught. A round that could not authenticate
   * photographs the login form for every route and has nothing to say about any
   * of them; throwing here is how that becomes a named failure instead of forty
   * misleading PNGs.
   */
    if (path !== '/login') {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('input[name="machine_identifier"]', target.machine_identifier);
      await page.fill('input[name="machine_secret"]', 'pw');
      await page.fill('input[name="external_ref"]', target.external_ref);
      await page.fill('input[name="operator_secret"]', 'pw');
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
    }

    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });

    /** The claim, the reason list and the first video frame all arrive late. */
    if (screen === 'review') await page.waitForTimeout(2500);
    else await page.waitForTimeout(600);

    const landed = new URL(page.url()).pathname;
    if (landed !== path) throw new Error(`asked for ${path}, ended on ${landed}`);
    await page.waitForSelector(landmark, { timeout: 8000 });

    /**
     * The two variables the whole matrix exists to vary, read back off the page.
     * A theme that silently did not apply produces forty shots of one theme and
     * forty filenames that still say otherwise.
     */
    const applied = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      theme: document.documentElement.dataset['theme'] ?? 'system',
    }));
    if (applied.theme !== theme) throw new Error(`asked for ${theme}, page is ${applied.theme}`);
    const wanted = locale === 'zh' ? 'zh-Hans' : 'en';
    if (applied.lang !== wanted) {
      throw new Error(`asked for ${wanted}, page is ${applied.lang || 'unset'}`);
    }

    /**
     * The document must not scroll sideways. Asserted, because a screenshot
     * cannot show it.
     *
     * This is the whole reason the matrix carries both locales: Chinese runs
     * shorter and denser and English wraps, so a row that fits in one language
     * pushes the page wider in the other — and a `fullPage` PNG of an
     * overflowing page simply comes out wider, looking correct. The review
     * transport did exactly this at 390px, where the marking group was wider
     * than the viewport in English and nine pixels wider again in Chinese.
     *
     * Content wider than the viewport is allowed *inside* something that scrolls
     * on purpose — the pipeline table, the nav pill row — because that is a
     * decision rather than an accident. What is checked is the document.
     */
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    if (overflow > 1) {
      throw new Error(`the page scrolls sideways by ${overflow}px at ${viewport.width}px wide`);
    }

    /**
     * The Chinese screen, read the way a screen reader reads it.
     *
     * `apps/console/test/screens.test.ts` scans the source and proves that
     * every key a screen asks for exists in both locales. It cannot prove the
     * rendered result, because a control can carry a perfectly good key and
     * still be announced in English — a `title` the component forgot to
     * translate, a label built from a union member, a state word interpolated
     * into a name. The person who finds that out is a Chinese reviewer using a
     * screen reader, and they are the least able to work around it.
     *
     * So on the `zh` half of the matrix the accessibility tree is walked and
     * every name is read. Two Latin words in a row is the shape of an English
     * sentence; one Latin token is a serial, a folder name, a requirement id or
     * a product name, all of which are correct as they stand and are printed
     * the same way in the brief in every language.
     */
    if (locale === 'zh') {
      /**
       * `ariaSnapshot`, not `page.accessibility.snapshot()`: the latter is gone
       * in Playwright 1.62 and reading it threw for every Chinese shot on the
       * first run of this check. The snapshot is YAML — `- button "提交并继续"`
       * — and the accessible name of every node is the quoted half.
       */
      const tree = await page.locator('body').ariaSnapshot();
      if (typeof tree !== 'string' || tree.length === 0) {
        throw new Error('the accessibility tree is empty');
      }
      const english = [...tree.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
        .map((m) => m[1])
        .filter((name) => ENGLISH_SENTENCE.test(name));
      if (english.length > 0) {
        throw new Error(`untranslated on the Chinese page — ${english.slice(0, 3).join(' | ')}`);
      }
    }

    const file = `${OUT}/${name}.png`;
    await page.screenshot({ path: file, fullPage: viewport === DESKTOP });

    console.log(`${file}${problems.length ? `   ${problems.length} problems` : ''}`);
    for (const p of problems.slice(0, 4)) console.log(`      ${p}`);
    return problems;
  } finally {
    await page.goto('about:blank').catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * The whole cross product, generated.
 *
 * A hand-picked list is how a matrix quietly loses its dark login and its
 * mobile pipeline: nobody notices a row that was never written. Five screens,
 * two viewports, two themes, two locales.
 */
const shots = [];
for (const screen of Object.keys(SCREENS)) {
  for (const [vname, viewport] of [
    ['desktop', DESKTOP],
    ['mobile', MOBILE],
  ]) {
    for (const theme of ['light', 'dark']) {
      for (const locale of ['en', 'zh']) {
        shots.push([`${screen}-${vname}-${theme}-${locale}`, { viewport, theme, locale, screen }]);
      }
    }
  }
}

const failed = [];
for (const [name, options] of shots) {
  try {
    const problems = await shoot(name, options);
    if (problems.length > 0) failed.push(`${name} — ${problems[0]}`);
  } catch (err) {
    console.log(`${name}  FAILED  ${err.message}`);
    failed.push(`${name} — ${err.message}`);
  }
}

await browser.close();

if (failed.length > 0) {
  console.log(`\n${failed.length} of ${shots.length} shots are not usable evidence:`);
  for (const f of failed) console.log(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\n${shots.length} shots written to ${OUT}`);
}
