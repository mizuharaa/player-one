/**
 * The inspection round: every screen, both viewports, both themes, both
 * languages, into `.impeccable/review/`.
 *
 * Not a test. It signs in with the seed credentials, walks the console, and
 * writes PNGs — which is the only way to judge contrast, overflow and the
 * things a typecheck cannot see. Run `seed-console.mjs` first.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.CONSOLE_URL ?? 'http://localhost:5173';
const OUT = '.impeccable/review';
await mkdir(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const browser = await chromium.launch();

/**
 * Both credentials, every time: a machine token for where, an operator token
 * for who — and it THROWS when either is refused.
 *
 * It used to swallow the failure: the URL wait carried a `.catch(() => {})`,
 * so a refused sign-in resolved like a successful one and every screenshot
 * after it was a picture of the sign-in page filed under the name of a screen.
 * A run with a bad operator secret produced 30 PNGs and printed nothing but
 * file names. What the server said is the useful part of that failure, so the
 * refusal is read off the `/api/session` response and put in the message.
 */
async function signIn(page, operator) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="machine_identifier"]', 'HCM-01');
  await page.fill('input[name="machine_secret"]', 'pw');
  await page.fill('input[name="external_ref"]', operator);
  await page.fill('input[name="operator_secret"]', 'pw');

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/session') && r.request().method() === 'POST',
      { timeout: 15000 },
    ),
    page.click('button[type="submit"]'),
  ]);

  if (!res.ok()) {
    const said = await res.text().catch(() => '');
    throw new Error(`sign-in as ${operator} refused: ${res.status()} ${said.slice(0, 200)}`);
  }

  /*
   * The 200 is the session; the redirect is the app acting on it. Both have to
   * happen before a shot, and a 200 that never leaves /login is its own bug.
   */
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
}

/**
 * Watch a page's claims, and hand the lease back before the context closes.
 *
 * `/review` claims an episode and holds a ten-minute lease, and the seed
 * leaves exactly one claimable episode — so a shot that walks away still
 * holding it makes every later review shot photograph "Nothing to review".
 * That is what the first two runs of this file produced, and it survived the
 * next run too, because the lease outlives the process.
 *
 * The screen's own release rides `pagehide` and `navigator.sendBeacon`, and
 * neither survives `context.close()` reliably: the event never fires, and a
 * beacon dispatched by hand is still in flight when the browser goes. So the
 * claim's own `episode_id` is read off the response and released with an
 * awaited request instead. Same endpoint the app uses; just a call that can be
 * waited for.
 */
async function watchClaims(page) {
  let episodeId = null;
  /**
   * Read the claim on the way through, not afterwards: a `response` listener
   * that awaits `res.json()` can find the body already gone, and it fails
   * quietly — which looks exactly like a screen that never claimed anything.
   */
  await page.route('**/api/review/claim', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.episode_id === 'string') episodeId = parsed.episode_id;
    } catch {
      /* 204, or not JSON: nothing was claimed. */
    }
    await route.fulfill({ response, body });
  });
  return async () => {
    if (episodeId === null) return;
    const status = await page
      .evaluate((id) => fetch(`/api/review/release/${id}`, { method: 'POST' }).then((r) => r.status), episodeId)
      .catch(() => 'threw');
    if (status !== 200 && status !== 204) console.log(`      lease NOT released (${status})`);
    episodeId = null;
  };
}

/**
 * The two routes that are not behind a session.
 *
 * `/discover` joined `/login` on 2026-09-08 when the product story was split
 * off the sign-in screen. Signing in before shooting a public route is not
 * merely wasteful: the seed has one claimable episode and every extra session
 * is another chance to walk away holding its lease.
 */
const PUBLIC = new Set(['/login', '/discover']);

/**
 * Read the whole page before a full-page capture.
 *
 * Home and `/discover` both reveal sections on scroll, and a `fullPage`
 * screenshot does not scroll — it stretches the viewport. So every section
 * below the fold was photographed at the `opacity: 0` GSAP had set on it and
 * never cleared, which is a picture of an empty page filed under the name of a
 * screen. Walking the document one viewport at a time fires every trigger
 * first. Same technique as `rhythm.mjs`, same reason.
 */
async function readWholePage(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 180));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
}

async function shoot(name, { viewport, theme, locale, path, prepare, operator = 'op-1', fullPage }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: locale === 'zh' ? 'zh-CN' : 'en-US',
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const releaseClaim = await watchClaims(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([t, l]) => {
      if (t === 'system') localStorage.removeItem('playerone.theme');
      else localStorage.setItem('playerone.theme', t);
      localStorage.setItem('playerone.locale', l);
    },
    [theme, locale],
  );

  try {
    /*
     * Inside the block, not before it. Signing in throws on a refusal now, and
     * outside the `try` that throw walked past the `finally` that hands the
     * lease back and closes the context — so the one run where authentication
     * broke was also the run that leaked a claim on an episode and left a
     * browser alive.
     */
    if (!PUBLIC.has(path)) await signIn(page, operator);

    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    if (prepare) await prepare(page);
    if (fullPage ?? viewport === DESKTOP) await readWholePage(page);
    await page.waitForTimeout(1200);

    const file = `${OUT}/${name}.png`;
  /*
   * Desktop shots are full-page by default, because a console screen is
   * usually taller than 900px and the part below the fold is the part nobody
   * looks at. Mobile opts in per shot.
   *
   * `/login` used to be the one exception: its film half was two and a bit
   * viewports tall with the form pinned inside it, and a full-page capture of
   * a `position: sticky` element renders it once at the bottom of a mostly
   * empty page. That layout is gone — the sign-in is one card on an ordinary
   * page — so the exception went with it.
   */
    await page.screenshot({ path: file, fullPage: fullPage ?? viewport === DESKTOP });
    console.log(`${file}${errors.length ? `   ⚠ ${errors.length} console errors` : ''}`);
    for (const e of errors.slice(0, 4)) console.log(`      ${e}`);
  } finally {
    /*
     * In a `finally` because a throw between the claim and here — a refused
     * sign-in, a timed-out wait, a failed screenshot — otherwise walks away
     * holding a ten-minute review lease, and the seed has exactly one
     * claimable episode. That is the bug this file's own comment above
     * describes, one level up.
     */
    await releaseClaim();
    await context.close();
  }
}

/** A signed-in session for one operator, closed however it ends. */
async function asOperator(operator, fn) {
  const context = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' });
  const page = await context.newPage();
  try {
    await signIn(page, operator);
    await fn(page);
  } catch (err) {
    console.log(`${operator}  SKIPPED  ${err.message}`);
  } finally {
    await context.close();
  }
}

/** A period is named by the Monday of its UTC week. */
function mondayUtc(weeksBack) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * weeksBack);
  return d.toISOString().slice(0, 10);
}

const CANDIDATES = [0, 1, 2, 3, 4, 5].map(mondayUtc);
let PERIOD = CANDIDATES[0];

/**
 * Issue the bills, then find the period that has them.
 *
 * Two operators, because the console will not let one do both. `op-1` issues:
 * `settlements_issuer_not_payer` means whoever raises a bill may not pay it,
 * so billing from inside a finance session photographs that refusal instead of
 * the screen. `fin-1` reads: `financeGuard` covers the payout lane's **reads**
 * as well, so an `op-1` session sees no bills at all — which is why the first
 * version of this, which counted rows as `op-1`, always concluded that every
 * period was empty.
 *
 * And the period is found rather than assumed. It is the Monday of the current
 * **UTC** week, while the seed's verdicts are stamped when the database was
 * seeded — so the instant UTC crosses into a Monday, the default period goes
 * empty and every settle, preflight, flags and exceptions shot is of an empty
 * state. That happened here, mid-run, at 00:00 UTC. A pinned date would rot
 * within the week, so this walks back a week at a time until a period has
 * bills.
 */
async function findAndBillThePeriod() {
  await asOperator('op-1', async (page) => {
    for (const period of CANDIDATES.slice(0, 2)) {
      await page.goto(`${BASE}/settle?period=${period}`, { waitUntil: 'networkidle' });
      await page
        .getByRole('button', { name: /generate bills/i })
        .click()
        .catch(() => {});
      await page.waitForTimeout(1500);
    }
  });

  await asOperator('fin-1', async (page) => {
    for (const period of CANDIDATES) {
      await page.goto(`${BASE}/settle?period=${period}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      if ((await page.locator('tbody tr').count()) > 0) {
        PERIOD = period;
        return;
      }
    }
  });

  console.log(`settle period    ${PERIOD}`);
}

await findAndBillThePeriod();

const shots = [
  // `/login` is an ordinary page now — one card, no pinned film half, no 180vh
  // of landing — so it takes an ordinary full-page capture. The shot that used
  // to sit next to this one, `login-desktop-scrolled`, photographed a parallax
  // that no longer exists and is gone.
  ['login-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/login' }],
  ['login-desktop-dark', { viewport: DESKTOP, theme: 'dark', locale: 'en', path: '/login' }],
  // The sign-in rule this screen is held to: the form is usable at 390px with
  // no scroll trap, no swipe and no animation first. A phone shot is the only
  // way to see whether that is still true.
  ['login-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/login', fullPage: true }],
  ['login-mobile-vi', { viewport: MOBILE, theme: 'light', locale: 'vi', path: '/login', fullPage: true }],
  // `/discover`: the product story, on its own public route. Full page in all
  // three languages, because the mosaic's cells and the four-step strip are
  // where a long Vietnamese sentence or a short Chinese one changes the shape
  // of a row.
  ['discover-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/discover' }],
  ['discover-desktop-dark', { viewport: DESKTOP, theme: 'dark', locale: 'en', path: '/discover' }],
  ['discover-desktop-vi', { viewport: DESKTOP, theme: 'light', locale: 'vi', path: '/discover' }],
  ['discover-desktop-zh', { viewport: DESKTOP, theme: 'dark', locale: 'zh', path: '/discover' }],
  ['discover-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/discover', fullPage: true }],
  ['home-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/' }],
  // The guided tour on its second step. The tour is the one thing on Home
  // that nothing else in this set shows, and step 2 is where the spotlight has
  // moved once — so it proves the dialog advances, not just that it opens.
  [
    'home-desktop-tour',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/',
      fullPage: false,
      /*
       * `dispatchEvent` and not `click`, and only until the identity track
       * merges: on this branch the tour's `PandaStage` is a full-viewport
       * canvas that still takes pointer events, so it is the topmost element
       * at the Next button's coordinates. A real click — `force` included —
       * lands on the canvas and the tour never advances; the shot came out as
       * step 1 twice before this was measured. Dispatching the event on the
       * element itself bypasses hit testing, which is exactly the difference
       * between "the button does not work here" and "the pointer cannot reach
       * it". The fix belongs in `PandaStage`, which another track owns.
       */
      prepare: async (p) => {
        await p.getByRole('button', { name: /show me around/i }).click();
        await p.waitForTimeout(800);
        await p.getByRole('button', { name: /^next$/i }).dispatchEvent('click');
        await p.waitForTimeout(900);
      },
    },
  ],
  ['home-desktop-dark', { viewport: DESKTOP, theme: 'dark', locale: 'en', path: '/' }],
  ['home-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/' }],
  [
    'review-desktop',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/review',
      // Mark a span so the scrubber and the estimate are showing real state.
      prepare: async (page) => {
        await page.waitForTimeout(2500);
        await page.keyboard.press('i');
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const v = document.querySelector('video');
          if (v) v.currentTime = 42;
        });
        await page.waitForTimeout(600);
        await page.keyboard.press('o');
        await page.waitForTimeout(300);
      },
    },
  ],
  [
    'review-desktop-zh',
    { viewport: MOBILE.width ? DESKTOP : DESKTOP, theme: 'light', locale: 'zh', path: '/review', prepare: async (p) => p.waitForTimeout(2500) },
  ],
  ['review-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/review', prepare: async (p) => p.waitForTimeout(2500) }],
  // The keyboard path, driven with no pointer at all: mark in, seek, mark out,
  // then verdict 1. Enter is deliberately NOT pressed — committing here would
  // take the seed's one claimable episode out of the queue for every other run.
  [
    'review-keyboard-desktop',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/review',
      prepare: async (page) => {
        await page.waitForTimeout(2500);
        await page.keyboard.press('i');
        /** ArrowRight is the seek. Twelve nudges of five seconds, no pointer. */
        for (let i = 0; i < 12; i += 1) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(60);
        }
        await page.waitForTimeout(400);
        await page.keyboard.press('o');
        await page.waitForTimeout(200);
        await page.keyboard.press('1');
        await page.waitForTimeout(300);
      },
    },
  ],
  // The back office is three tabs on one screen, so it takes three shots: the
  // tab is not in the URL and a single one would only ever show the tasks table.
  ['backoffice-tasks-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/backoffice' }],
  [
    'backoffice-collectors-desktop-dark',
    {
      viewport: DESKTOP,
      theme: 'dark',
      locale: 'zh',
      path: '/backoffice',
      prepare: async (p) => {
        await p.getByRole('tab').nth(1).click();
        await p.waitForTimeout(600);
      },
    },
  ],
  [
    'backoffice-devices-mobile',
    {
      viewport: MOBILE,
      theme: 'light',
      locale: 'en',
      path: '/backoffice',
      prepare: async (p) => {
        await p.getByRole('tab').nth(2).click();
        await p.waitForTimeout(600);
      },
    },
  ],
  ['pipeline-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/pipeline' }],
  ['pipeline-desktop-dark', { viewport: DESKTOP, theme: 'dark', locale: 'zh', path: '/pipeline' }],
  ['notbuilt-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/counter' }],
  // `/episodes` reads three endpoints in two different scopes, and the whole
  // design problem is that the two lists look alike and count different
  // populations. Three shots: the scope sentences and the batch summary at
  // desktop, the same in Chinese on the dark scheme where the two section
  // headings have to stay tellable apart, and the phone, where they stack and
  // the second scope's heading is the only thing separating them.
  ['episodes-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/episodes' }],
  ['episodes-desktop-dark-zh', { viewport: DESKTOP, theme: 'dark', locale: 'zh', path: '/episodes' }],
  ['episodes-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/episodes' }],
  // Settle and the payout console. The seed's three verdicts sit in the
  // current week, so the first shot generates the period's bills and the
  // rest read them.
  //
  // These run as `fin-1`, the seed's finance operator, and they have to.
  // `financeGuard` covers every route on the payout lane, **reads included** —
  // it was tightened when a counter operator at an unrelated centre was
  // measured getting 200 on a collector's bank details and the whole period's
  // batch. So an `op-1` session does not get a read-only view of these
  // screens; it gets 403 and "this period did not load", and every shot of
  // Settle, Preflight, Exceptions and Risk taken as `op-1` is a picture of an
  // error box rather than of the screen.
  [
    'settle-bills-desktop',
    { operator: 'fin-1',
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: `/settle?period=${PERIOD}`,
    },
  ],
  ['settle-bills-mobile-vi', { operator: 'fin-1', viewport: MOBILE, theme: 'light', locale: 'vi', path: `/settle?period=${PERIOD}` }],
  ['settle-preflight-desktop-dark-zh', { operator: 'fin-1', viewport: DESKTOP, theme: 'dark', locale: 'zh', path: `/settle/preflight?period=${PERIOD}` }],
  [
    'settle-preflight-desktop',
    { operator: 'fin-1', viewport: DESKTOP, theme: 'light', locale: 'en', path: `/settle/preflight?period=${PERIOD}` },
  ],
  ['settle-preflight-mobile', { operator: 'fin-1', viewport: MOBILE, theme: 'light', locale: 'en', path: `/settle/preflight?period=${PERIOD}` }],
  [
    'settle-bill-desktop',
    { operator: 'fin-1',
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: `/settle?period=${PERIOD}`,
      // Follow the row's own link rather than clicking it: something in the
      // shell sits over the table's last column and the click never lands,
      // which is why this shot has been missing from the folder.
      prepare: async (p) => {
        const href = await p.getByRole('link', { name: /^open$/i }).first().getAttribute('href');
        await p.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
        await p.waitForTimeout(1200);
      },
    },
  ],
  ['settle-exceptions-desktop-vi', { operator: 'fin-1', viewport: DESKTOP, theme: 'light', locale: 'vi', path: `/settle/exceptions?period=${PERIOD}` }],
  ['risk-desktop-dark', { operator: 'fin-1', viewport: DESKTOP, theme: 'dark', locale: 'en', path: `/risk?period=${PERIOD}` }],
  ['risk-mobile-zh', { operator: 'fin-1', viewport: MOBILE, theme: 'light', locale: 'zh', path: `/risk?period=${PERIOD}` }],
];

for (const [name, options] of shots) {
  try {
    await shoot(name, options);
  } catch (err) {
    console.log(`${name}  FAILED  ${err.message}`);
  }
}

/**
 * "Nothing to review", photographed honestly.
 *
 * The empty state is the one screen the mascot is barred from — nothing
 * cartoon stands next to footage, and the queue reaching zero is still that
 * screen — so it is worth a picture. It cannot be faked by pointing at an
 * empty database, because the seeded one is not empty. Instead a first context
 * claims the only claimable episode and keeps its lease, and a second context
 * then asks for work and is told there is none. The holder hands the lease
 * back afterwards so the next run of this file still finds an episode.
 */
async function shootEmptyQueue() {
  const holder = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' });
  const page = await holder.newPage();
  const releaseClaim = await watchClaims(page);
  try {
    await signIn(page, 'op-1');
    await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    await shoot('review-empty-desktop', {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/review',
      prepare: async (p) => p.waitForTimeout(2500),
    });

  } catch (err) {
    console.log(`review-empty-desktop  FAILED  ${err.message}`);
  }
  await releaseClaim();
  await holder.close();
}

await shootEmptyQueue();

await browser.close();
