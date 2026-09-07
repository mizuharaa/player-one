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

async function shoot(name, { viewport, theme, locale, path, prepare, fullPage }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: locale === 'zh' ? 'zh-CN' : 'en-US',
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([t, l]) => {
      if (t === 'system') localStorage.removeItem('playerone.theme');
      else localStorage.setItem('playerone.theme', t);
      localStorage.setItem('playerone.locale', l);
    },
    [theme, locale],
  );

  // Sign in unless we are shooting the sign-in screen itself.
  if (path !== '/login') {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="machine_identifier"]', 'HCM-01');
    await page.fill('input[name="machine_secret"]', 'pw');
    await page.fill('input[name="external_ref"]', 'op-1');
    await page.fill('input[name="operator_secret"]', 'pw');
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
  }

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  if (prepare) await prepare(page);
  await page.waitForTimeout(1200);

  const file = `${OUT}/${name}.png`;
  /*
   * Desktop shots are full-page by default, because a console screen is
   * usually taller than 900px and the part below the fold is the part nobody
   * looks at. `/login` is the exception and has to opt out: its film half is
   * two and a bit viewports tall with the panel pinned inside it, and a
   * full-page capture of a `position: sticky` element renders it once at the
   * bottom of a mostly empty page — a picture of the layout's implementation
   * rather than of what anybody sees. Those shots are viewport captures.
   */
  await page.screenshot({ path: file, fullPage: fullPage ?? viewport === DESKTOP });
  console.log(`${file}${errors.length ? `   ⚠ ${errors.length} console errors` : ''}`);
  for (const e of errors.slice(0, 4)) console.log(`      ${e}`);
  await context.close();
}

const shots = [
  ['login-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/login', fullPage: false }],
  // The parallax, proved rather than asserted. 400px down the film half, the
  // three slogans have risen and staggered apart and the form column has not
  // moved a pixel — which is the whole claim this screen makes about its one
  // authored motion, and the only way to see it in a still.
  [
    'login-desktop-scrolled',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/login',
      fullPage: false,
      prepare: async (p) => {
        await p.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
        await p.waitForTimeout(900);
      },
    },
  ],
  // The sign-in rule this screen is held to: the form is usable at 390px with
  // no scroll, no swipe and no animation first. A phone shot is the only way
  // to see whether that is still true, and it is a viewport capture on
  // purpose — a full-page one would show the submit button wherever it lands
  // in the document instead of where the reader's thumb finds it.
  ['login-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/login' }],
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
  // rest read them. `op-1` is not finance: every payment control renders
  // disabled with its reason, which is the state worth a picture.
  [
    'settle-bills-desktop',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/settle',
      prepare: async (p) => {
        await p.getByRole('button', { name: /generate bills/i }).click();
        await p.waitForTimeout(1500);
      },
    },
  ],
  ['settle-bills-mobile-vi', { viewport: MOBILE, theme: 'light', locale: 'vi', path: '/settle' }],
  ['settle-preflight-desktop-dark-zh', { viewport: DESKTOP, theme: 'dark', locale: 'zh', path: '/settle/preflight' }],
  ['settle-preflight-mobile', { viewport: MOBILE, theme: 'light', locale: 'en', path: '/settle/preflight' }],
  [
    'settle-bill-desktop',
    {
      viewport: DESKTOP,
      theme: 'light',
      locale: 'en',
      path: '/settle',
      prepare: async (p) => {
        await p.getByRole('link', { name: /^open$/i }).first().click();
        await p.waitForTimeout(1200);
      },
    },
  ],
  ['settle-exceptions-desktop-vi', { viewport: DESKTOP, theme: 'light', locale: 'vi', path: '/settle/exceptions' }],
  ['risk-desktop-dark', { viewport: DESKTOP, theme: 'dark', locale: 'en', path: '/risk' }],
  ['risk-mobile-zh', { viewport: MOBILE, theme: 'light', locale: 'zh', path: '/risk' }],
];

for (const [name, options] of shots) {
  try {
    await shoot(name, options);
  } catch (err) {
    console.log(`${name}  FAILED  ${err.message}`);
  }
}

await browser.close();
