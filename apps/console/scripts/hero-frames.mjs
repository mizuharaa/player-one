/**
 * Five frames off the hero's cursor path, plus the reduced-motion state.
 *
 * The frames are approach, press, release, pan and zoom, at 1440 and at 390.
 * Each one is caught by waiting on what the cursor hook itself writes to the
 * DOM — `data-pressing` on the cursor, `data-step` on the window, and the
 * `--pan` / `--zoom` custom properties on the window content — so a frame is
 * the state it is named after and not a guess at a timestamp.
 *
 * **The clock is scaled, and the motion is not.** A press lasts 120ms, and a
 * `waitForFunction` that resolves inside it still has to make a round trip and
 * take a screenshot, which does not fit. So an init script wraps
 * `requestAnimationFrame` and hands the callback a timestamp multiplied by
 * RATE. The hook integrates in whatever time-units it is given, so every
 * spring's shape, every beat's ordering and every ratio between them is
 * identical — only wall clock is stretched. It is the same technique as
 * stepping a physics engine at a fixed substep, and it is the only way to
 * photograph a 120ms event without asking the page to lie about its state.
 *
 * Run against the dev server, no database:
 *   CONSOLE_URL=http://127.0.0.1:5190 node apps/console/scripts/hero-frames.mjs
 */
import { chromium } from 'playwright';
import { acquireLock, guard } from './browser.mjs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';
const OUT = process.env.HERO_SHOTS ?? 'C:/build/console-hero-shots';
/** 4×. Below about 3× the press is still too short to photograph reliably. */
const RATE = Number(process.env.HERO_RATE ?? 0.25);
const SIZES = [
  [1440, 900],
  [390, 844],
];

/* The cookie banner is fixed to the bottom of the viewport and covers the
   footer row, which is one of the things these frames are meant to show. */
const settle = (ctx) =>
  ctx.addInitScript(() => {
    try {
      localStorage.setItem('playerone:showcase-cookie-choice:v1', 'declined');
    } catch {
      /* private mode */
    }
  });

const slow = (ctx, rate) =>
  ctx.addInitScript((r) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t * r));
  }, rate);

/** Read what the hook has written this frame. One shape, used by every wait. */
const STATE = () => {
  const win = document.querySelector('.operator-window');
  const frame = document.querySelector('.operator-window-content');
  const cursor = document.querySelector('.operator-cursor');
  if (!win || !frame || !cursor) return null;
  return {
    step: Number(win.dataset.step ?? -1),
    pressing: cursor.dataset.pressing === 'true',
    pan: Math.abs(Number(frame.dataset.pan ?? 0)),
    zoom: Number(frame.dataset.zoom ?? 1),
  };
};

async function shoot(page, selector, path) {
  await page.locator(selector).screenshot({ path });
  console.log(`  ${path}`);
}

const release = await acquireLock();
const browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] });
const close = guard(browser, release);
try {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    await settle(ctx);
    await slow(ctx, RATE);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.operator-window', { timeout: 20000 });
    await page.locator('.operator-window').scrollIntoViewIfNeeded();
    /* The demo only runs while a quarter of the window is on screen. */
    await page.waitForSelector('.operator-hero[data-running="true"]', { timeout: 20000 });
    console.log(`\n--- ${w}x${h} ---`);

    const wait = (fn, name) =>
      page
        .waitForFunction(fn, undefined, { polling: 'raf', timeout: 120000 })
        .catch((e) => {
          throw new Error(`${name}: ${String(e).slice(0, 80)}`);
        });

    /* 1. APPROACH — step 1, in flight toward the first criterion, nothing
       pressed, the zoom still growing. */
    await wait(
      `(${STATE})() && (${STATE})().step === 1 && !(${STATE})().pressing && (${STATE})().zoom > 1.004 && (${STATE})().zoom < 1.05`,
      'approach',
    );
    await shoot(page, '.operator-window', `${OUT}/cursor-approach-${w}.png`);

    /* 2. PRESS — the button is down: cursor at scale .92, control carrying
       `data-demo-press`, and its own click() already fired. */
    await wait(`(${STATE})() && (${STATE})().pressing`, 'press');
    await shoot(page, '.operator-window', `${OUT}/cursor-press-${w}.png`);

    /* 3. RELEASE — the frame after the press ends, criterion now pressed. */
    await wait(`(${STATE})() && !(${STATE})().pressing`, 'release');
    await shoot(page, '.operator-window', `${OUT}/cursor-release-${w}.png`);

    /* 4. ZOOM — the footage held at the full 1.06. */
    await wait(`(${STATE})() && (${STATE})().zoom > 1.055`, 'zoom');
    await shoot(page, '.operator-window', `${OUT}/cursor-zoom-${w}.png`);

    /* 5. PAN — step 2, the panned region mid-glide. */
    await wait(
      `(${STATE})() && (${STATE})().step === 2 && (${STATE})().pan > 3 && (${STATE})().pan < 23`,
      'pan',
    );
    await shoot(page, '.operator-window', `${OUT}/cursor-pan-${w}.png`);

    await ctx.close();

    /* And the same hero with motion off: no cursor, no zoom, no pan, states
       turning over on a timer with the cross-fade as the only motion. */
    const still = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    await settle(still);
    const quiet = await still.newPage();
    await quiet.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
    await quiet.waitForSelector('.operator-hero', { timeout: 20000 });
    await quiet.locator('.operator-hero').scrollIntoViewIfNeeded();
    await quiet.waitForTimeout(900);
    await shoot(quiet, '.operator-hero', `${OUT}/reduced-motion-${w}.png`);
    await still.close();
  }
} finally {
  await close();
}
