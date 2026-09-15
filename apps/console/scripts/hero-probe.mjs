/**
 * The hero window's own contrast sweep, per demo state.
 *
 * `contrast.mjs` is the probe of record and its `/discover` table now carries
 * the hero's resting state. It cannot reach the other four, because under
 * `reducedMotion: reduce` the demo holds at step 0 and every later screen is
 * `visibility: hidden` — an element with no painted pixels has no ratio.
 *
 * So this drives the step nav and measures each state in turn, using the SAME
 * two techniques `contrast.mjs` documents, copied deliberately rather than
 * imported: only pixels a glyph FULLY owns (within 24 per channel of the
 * declared ink) count, because on 13px type the antialiased rim outnumbers the
 * core and averaging it reports a ratio halfway to the ground that nobody
 * experiences. `transition: none` goes on first, or the second render catches
 * a colour fade in progress.
 *
 *   node apps/console/scripts/hero-probe.mjs [tag]
 */
import { chromium } from 'playwright';
import { acquireLock, guard } from './browser.mjs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';
const TAG = process.argv[2] ?? 'run';

const lum = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

async function grab(page, clip) {
  const buf = await page.screenshot({
    clip: {
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      width: Math.round(clip.w),
      height: Math.round(clip.h),
    },
  });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: d.width, height: d.height, data: Array.from(d.data) };
  }, buf.toString('base64'));
}
const at = (png, x, y) => {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

async function inkRatio(page, selector, index = 0) {
  const all = page.locator(selector);
  if ((await all.count()) === 0) return { err: 'NO MATCH — fix the selector' };
  const handle = all.nth(index);
  if (!(await handle.isVisible().catch(() => false))) return { err: 'not visible' };
  /* Centre it, or the clip lands outside the viewport after a nav click. */
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const box = await handle.boundingBox();
  if (box === null || box.width < 2 || box.height < 2) return { err: 'no box' };
  const clip = { x: box.x, y: box.y, w: Math.min(box.width, 900), h: Math.min(box.height, 200) };

  const before = await grab(page, clip);
  const ink = await handle.evaluate((el) => getComputedStyle(el).color);
  await handle.evaluate((el) => {
    el.dataset.probeColor = el.style.color;
    el.dataset.probeTransition = el.style.transition;
    el.style.transition = 'none';
    el.style.color = 'transparent';
  });
  await page.waitForTimeout(80);
  const after = await grab(page, clip);
  await handle.evaluate((el) => {
    el.style.color = el.dataset.probeColor ?? '';
    el.style.transition = el.dataset.probeTransition ?? '';
    delete el.dataset.probeColor;
    delete el.dataset.probeTransition;
  });

  const inkRgb = ink.match(/[\d.]+/g).slice(0, 3).map(Number);
  let n = 0;
  let sum = [0, 0, 0];
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const a = at(before, x, y);
      if (
        Math.abs(a[0] - inkRgb[0]) > 24 ||
        Math.abs(a[1] - inkRgb[1]) > 24 ||
        Math.abs(a[2] - inkRgb[2]) > 24
      )
        continue;
      const b = at(after, x, y);
      const delta = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (delta < 40) continue;
      n += 1;
      sum = [sum[0] + b[0], sum[1] + b[1], sum[2] + b[2]];
    }
  }
  if (n === 0) return { err: 'no covered pixels' };
  const ground = sum.map((v) => v / n);
  return { ratio: ratio(inkRgb, ground), ground: hex(ground), ink: hex(inkRgb), covered: n };
}

/* Large text under WCAG is >=18.66px bold or >=24px; everything else is body. */
const LARGE = new Set(['hero headline', 'desk title', 'inbox heading', 'payment heading', 'receipt amount']);

/** [label, selector, index] per step, plus the chrome that is on every step. */
const CHROME = [
  ['hero headline', '.operator-intro h2'],
  ['hero lead', '.operator-intro>p'],
  ['url', '.operator-url'],
  ['url note', '.operator-url-note'],
  ['queue label', '.operator-desk-heading>div>span'],
  ['desk title', '.operator-desk-heading h3'],
  ['status pill', '.operator-status'],
  ['footer identity', '.operator-desk>footer>span'],
  ['footer button', '.operator-desk>footer button'],
  ['caption title', '.operator-captions strong', 0],
  ['caption body', '.operator-captions p', 0],
  ['step nav current', '.operator-step-nav button', 0],
  ['step nav resting', '.operator-step-nav button', 1],
  ['disclosure', '.operator-disclosure'],
];
const PER_STEP = [
  [
    ['inbox heading', '.operator-inbox-title h4'],
    ['ready-for-review tier', '.operator-inbox-title>span:last-child'],
    ['file row title', '.operator-file-row strong'],
    ['file row sub', '.operator-file-row small'],
    ['file meta', '.operator-file-meta span'],
    ['transfer label', '.operator-transfer span'],
  ],
  [
    ['checklist heading', '.operator-review-checklist strong'],
    ['criterion label', '.operator-criteria>button', 0],
    ['footage label', '.operator-footage-label'],
    ['footage time', '.operator-time'],
  ],
  [
    ['verdict name', '.operator-verdict strong'],
    ['verdict effective', '.operator-verdict>span:last-child'],
    ['verdict reason', '.operator-verdict-panel>p'],
  ],
  [
    ['payment brand', '.operator-payment-brand span'],
    ['payment heading', '.operator-payment h4'],
    ['qr note', '.operator-payment>p'],
    ['confirm button', '.operator-payment>button'],
  ],
  [
    ['receipt heading', '.operator-receipt h4'],
    ['receipt amount', '.operator-amount'],
    ['receipt caveat', '.operator-receipt>small'],
    ['receipt term', '.operator-receipt dt', 0],
    ['receipt value', '.operator-receipt dd', 0],
  ],
];

const release = await acquireLock();
const browser = await chromium.launch({
  args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--force-color-profile=srgb'],
});
const close = guard(browser, release);
let worst = { body: Infinity, large: Infinity };
try {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    });
    /* The cookie banner is fixed to the bottom of the viewport and sits over
       the footer row, which is one of the things being measured. */
    await ctx.addInitScript(() => {
      try { localStorage.setItem('playerone:showcase-cookie-choice:v1', 'declined'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.operator-window', { timeout: 20000 });
    await page.locator('.operator-window').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    console.log(`\n================ ${TAG} · ${w}x${h} ================`);
    for (let step = 0; step < 5; step += 1) {
      await page.locator('.operator-step-nav button').nth(step).click();
      await page.waitForTimeout(500);
      console.log(`\n-- step ${step} --`);
      for (const [label, sel, i] of [...(step === 0 ? CHROME : []), ...PER_STEP[step]]) {
        const r = await inkRatio(page, sel, i ?? 0);
        if (r.err) {
          console.log(`?? ${label.padEnd(24)} ${r.err}   ${sel}`);
          continue;
        }
        const floor = LARGE.has(label) ? 3 : 4.5;
        const key = LARGE.has(label) ? 'large' : 'body';
        worst[key] = Math.min(worst[key], r.ratio);
        console.log(
          `${r.ratio >= floor ? '  ' : '<<'} ${label.padEnd(24)} ${`${r.ratio.toFixed(2)}:1`.padStart(8)}  ink ${r.ink} on ${r.ground}  ${r.covered}px`,
        );
      }
    }
    await ctx.close();
  }
  console.log(
    `\n${TAG} worst: body ${worst.body.toFixed(2)}:1 (floor 4.5) · large ${worst.large.toFixed(2)}:1 (floor 3.0)`,
  );
} finally {
  await close();
}
