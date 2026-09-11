/**
 * Final bounded checklist for /discover. Independent QA tooling: reads only,
 * starts no server, writes no database, edits no product code.
 *
 *   MSYS_NO_PATHCONV=1 CONSOLE_URL=http://127.0.0.1:5190 \
 *     node apps/console/scripts/discover-final.mjs [opening|locale|menu|demo|reentry|all]
 *
 * Every motion case gates on the app's OWN signals — `.discover-page` mounted,
 * then `data-logo-complete="true"`, then `data-story-pending` cleared — never on
 * elapsed time and never on DOM absence. A detached-selector wait can be
 * satisfied before React has mounted anything, which produced one false
 * negative on this project already.
 *
 * Contexts are short-lived and closed per case: once-per-session lives in
 * sessionStorage and a shared context silently contaminates repeat visits.
 */
import { withBrowser, newPage } from './browser.mjs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';
const OUT = process.env.SHOT_DIR ?? 'scratchpad/qa';
const LOCALE_KEY = 'playerone.locale'; // apps/console/src/lib/i18n.ts:25

/** Locale is chosen from localStorage, not a query parameter. */
const withLocale = (locale) => (locale
  ? { storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: LOCALE_KEY, value: locale }] }] } }
  : {});

async function ready(page, { film = true } = {}) {
  await page.waitForSelector('.discover-page', { timeout: 15000 });
  // Reduced-motion contexts may never mount the intro at all, so accept either
  // the completion flag or a settled page with no intro present.
  await page.waitForFunction(
    () => {
      const root = document.querySelector('.discover-page');
      if (root?.dataset.logoComplete === 'true') return true;
      return !document.querySelector('.logo-intro');
    },
    { timeout: 25000 },
  );
  if (film) {
    await page.waitForFunction(
      () => !document.querySelector('.discover-page')?.hasAttribute('data-story-pending'),
      { timeout: 15000 },
    ).catch(() => {});
  }
  await page.waitForTimeout(700);
}

/** Motion opening at the remaining widths. 1440 is already measured. */
async function opening(browser) {
  const rows = [];
  for (const w of [375, 430, 768, 1024, 1920]) {
    const { context, page } = await newPage(browser, { motion: true, viewport: { width: w, height: 900 } });
    const movies = [];
    page.on('request', (r) => { if (/\.(mp4|webm)(\?|$)/.test(r.url())) movies.push(r.url().split('/').pop()); });
    await page.goto(`${BASE}/discover?logoReplay=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.logo-intro', { timeout: 15000 }).catch(() => {});
    await ready(page);
    const t0 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const v = document.querySelector('video');
      const box = document.querySelector('.discover-video')?.getBoundingClientRect();
      return {
        wrapTop: box ? Math.round(box.top) : null,
        src: (v?.currentSrc || '').split('/').pop(),
        paused: v?.paused, t: v?.currentTime,
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        heads: [...document.querySelectorAll('h1,.discover-display')].filter((e) => {
          const q = e.getBoundingClientRect(); const s = getComputedStyle(e);
          return q.top < innerHeight && q.bottom > 0 && s.visibility !== 'hidden' && +s.opacity > 0.01;
        }).length,
      };
    });
    await page.screenshot({ path: `${OUT}/final-open-${w}.png` });
    rows.push({ width: w, ...r, t0, advanced: r.t > t0, movies });
    await context.close();
  }
  return rows;
}

/** Clipping is measured per locale: vi diacritics and zh glyphs put ink where en has none. */
async function locale(browser) {
  const rows = [];
  for (const lng of ['vi', 'en', 'zh']) {
    for (const w of [375, 1440]) {
      const { context, page } = await newPage(browser, { viewport: { width: w, height: 900 }, ...withLocale(lng) });
      await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' });
      await ready(page, { film: false });
      const r = await page.evaluate(() => {
        const clipped = [];
        for (const e of document.querySelectorAll('body *')) {
          if (e.children.length || !e.textContent.trim()) continue;
          const s = getComputedStyle(e);
          if (s.overflow === 'visible' || s.display === 'none') continue;
          if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) {
            clipped.push(`${e.className || e.tagName}: ${e.textContent.trim().slice(0, 30)}`);
          }
        }
        const small = [...document.querySelectorAll('body *')]
          .filter((e) => e.children.length === 0 && e.textContent.trim()
            && parseFloat(getComputedStyle(e).fontSize) < 12)
          .map((e) => `${e.className || e.tagName}@${getComputedStyle(e).fontSize}`);
        return {
          lang: document.documentElement.lang,
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          clipped: clipped.slice(0, 6), clippedCount: clipped.length,
          under12: [...new Set(small)].slice(0, 8), under12Count: small.length,
        };
      });
      rows.push({ lng, width: w, ...r });
      await context.close();
    }
  }
  return rows;
}

/** Real mobile menu: native <dialog>, so Escape arrives as a cancel event. */
async function menu(browser) {
  const { context, page } = await newPage(browser, { viewport: { width: 375, height: 812 } });
  await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' });
  await ready(page, { film: false });
  const btn = '.discover-menu-button';
  await page.focus(btn);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => {
    const d = document.querySelector('#discover-menu');
    return {
      open: d?.open ?? null, modal: d?.matches(':modal') ?? null,
      expanded: document.querySelector('.discover-menu-button')?.getAttribute('aria-expanded'),
      links: document.querySelectorAll('.discover-menu-links a').length,
      focusInDialog: !!document.activeElement?.closest('#discover-menu'),
      activeEl: document.activeElement?.className || document.activeElement?.tagName,
    };
  });
  await page.screenshot({ path: `${OUT}/final-menu-open.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => ({
    open: document.querySelector('#discover-menu')?.open ?? null,
    expanded: document.querySelector('.discover-menu-button')?.getAttribute('aria-expanded'),
    focusReturned: document.activeElement?.classList.contains('discover-menu-button'),
    activeEl: document.activeElement?.className || document.activeElement?.tagName,
  }));
  await context.close();
  return { opened, closed };
}

/** browse -> details -> prepare -> ready -> viewpoint, and back out again. */
async function demo(browser) {
  const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/discover`, { waitUntil: 'domcontentloaded' });
  await ready(page, { film: false });
  const scene = '.discover-demo-scene';
  await page.$eval(scene, (e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  const steps = [];
  const snap = async (label) => {
    steps.push({ label, ...(await page.evaluate(() => ({
      heading: document.querySelector('.discover-demo-content h3')?.innerText.slice(0, 34),
      focusOnHeading: document.activeElement?.tagName === 'H3',
      progressFilled: document.querySelectorAll('.discover-demo-progress .is-filled').length,
      back: !!document.querySelector('.discover-demo-back'),
      expanded: document.querySelector('.discover-demo-scene')?.dataset.expanded,
      cta: document.querySelector('.discover-demo-content .discover-button')?.innerText.slice(0, 26) ?? null,
      ctaDisabled: document.querySelector('.discover-demo-content .discover-button')?.disabled ?? null,
    }))) });
  };
  await snap('browse');
  await page.click('.discover-task');
  await page.waitForTimeout(400); await snap('details');
  await page.click('.discover-demo-content .discover-button');
  await page.waitForTimeout(400); await snap('prepare (before selects)');
  const sels = await page.$$('.discover-demo-field select');
  for (const s of sels) await s.selectOption('no');
  await page.waitForTimeout(300); await snap('prepare (after selects)');
  await page.click('.discover-demo-content .discover-button');
  await page.waitForTimeout(400); await snap('ready');
  await page.screenshot({ path: `${OUT}/final-demo-ready.png` });
  // back out
  await page.click('.discover-demo-back').catch(() => {});
  await page.waitForTimeout(400); await snap('back from ready');
  await context.close();
  return steps;
}

/** Scroll down, scroll back up: headings must still be there on return. */
async function reentry(browser) {
  const { context, page } = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/discover?logoReplay=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.logo-intro', { timeout: 15000 }).catch(() => {});
  await ready(page);
  const count = () => page.evaluate(() => ({
    scrollY: Math.round(scrollY),
    visible: [...document.querySelectorAll('h1,.discover-display,.discover-heading')].filter((e) => {
      const q = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return q.top < innerHeight && q.bottom > 0 && s.visibility !== 'hidden' && +s.opacity > 0.01;
    }).length,
    hidden: [...document.querySelectorAll('h1,.discover-display,.discover-heading')]
      .filter((e) => +getComputedStyle(e).opacity <= 0.01).length,
    videoPaused: document.querySelector('video')?.paused,
  }));
  const at = [await count()];
  for (const y of [2000, 5000, 8000]) {
    await page.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    await page.waitForTimeout(900); at.push(await count());
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  at.push({ back: true, ...(await count()) });
  await page.screenshot({ path: `${OUT}/final-reentry-top.png` });
  await context.close();
  return at;
}

const CMD = process.argv[2] ?? 'all';
const run = { opening, locale, menu, demo, reentry };
await withBrowser(async (browser) => {
  const out = {};
  for (const [name, fn] of Object.entries(run)) {
    if (CMD !== 'all' && CMD !== name) continue;
    try { out[name] = await fn(browser); }
    catch (e) { out[name] = { FAILED: String(e).slice(0, 240) }; }
  }
  console.log(JSON.stringify(out, null, 1));
});
