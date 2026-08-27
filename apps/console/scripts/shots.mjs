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

async function shoot(name, { viewport, theme, locale, path, prepare }) {
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
  await page.screenshot({ path: file, fullPage: viewport === DESKTOP });
  console.log(`${file}${errors.length ? `   ⚠ ${errors.length} console errors` : ''}`);
  for (const e of errors.slice(0, 4)) console.log(`      ${e}`);
  await context.close();
}

const shots = [
  ['login-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/login' }],
  ['home-desktop', { viewport: DESKTOP, theme: 'light', locale: 'en', path: '/' }],
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
