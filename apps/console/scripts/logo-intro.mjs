/**
 * Bounded visual QA probe for the PlayerOne logo assembly intro on /discover.
 *
 * Independent QA tooling. Reads only — it never edits product code, never
 * writes to a database and never starts a server. Every browser context goes
 * through withBrowser/newPage so the shared lock is respected.
 *
 * Stage sampling is DETERMINISTIC: it drives the ?logoDebug=1 progress slider,
 * which calls timeline.pause().progress(v). Stages are never sampled by
 * elapsed wall-clock time — that axis produced a retracted finding on this
 * project once already.
 *
 *   MSYS_NO_PATHCONV=1 CONSOLE_URL=http://127.0.0.1:5190 \
 *     node apps/console/scripts/logo-intro.mjs stages
 *
 * Subcommands: stages | widths | lifecycle | surfaces | contrast | all
 */
import { withBrowser, newPage } from './browser.mjs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';
const LOCALE = process.env.LOCALE ?? '';
const OUT = process.env.SHOT_DIR ?? 'scratchpad/logo-intro';

/**
 * Stage boundaries are DERIVED FROM SOURCE, not guessed, and not read off a
 * screenshot. From logoMotion.ts on a 2.36s master timeline:
 *
 *   0.00-0.28  svg .97 -> 1                     (compact mark, two discs)
 *   0.25-0.73  unfold  (start 0.25 + delay*0.25, dur 0.42; delay 0.00-0.24)
 *   0.61-1.69  assemble (start 0.61 + delay,    dur 0.84)
 *   1.70       set exact identity on all 32     (mechanical settle)
 *   1.72       measure docking against nav target
 *   1.74-2.30  carrier docks
 *   1.82-2.36  ink background lifts (yPercent -100)
 *
 * 2.36s total corroborates the stated figure by arithmetic, from source.
 *
 * NOTE the deliberate overlap: the last unfold ends at 0.73 but the first
 * assembly begins at 0.61. There is therefore NO instant at which all 32
 * pieces sit in the intermediate rows with none yet assembling. 0.67 is the
 * most-unfolded representative frame, not a clean phase boundary — do not
 * report it as one.
 */
const T = 2.36;
const STAGES = [
  { key: 'a-compact', t: 0.15, note: 'compact mark, discs cover colocated fragments' },
  { key: 'b-primitives', t: 0.67, note: 'most-unfolded abstract rows (overlaps assembly by design)' },
  { key: 'c-assembled', t: 1.72, note: 'identity transforms, settled, pre-dock' },
  { key: 'd-docking', t: 2.05, note: 'mid-dock, ink lifting' },
  { key: 'e-docked', t: 2.36, note: 'dock endpoint' },
];

const url = (params = '') => {
  const u = new URL('/discover', BASE);
  for (const [k, v] of new URLSearchParams(params)) u.searchParams.set(k, v);
  if (LOCALE) u.searchParams.set('lng', LOCALE);
  return u.toString();
};

/** React listens for 'input' on a range; setting .value alone does nothing. */
async function seek(page, progress) {
  await page.$eval(
    '.logo-intro__debug input[type=range]',
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    progress,
  );
  await page.waitForTimeout(120);
}

/** Invariants that must hold at EVERY stage. */
async function invariants(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.logo-intro .assembly-logo');
    if (!svg) return { error: 'no intro svg' };
    const groups = [...svg.querySelectorAll('[data-logo-piece]')];
    const vb = svg.getAttribute('viewBox');
    const box = svg.getBoundingClientRect();
    return {
      paths: svg.querySelectorAll('path').length,
      pieces: groups.length,
      ids: groups.map((g) => g.dataset.logoPiece),
      // Glyphs must be geometry, never type. <title> is debug-only and is
      // counted separately so the two are never conflated.
      textEls: svg.querySelectorAll('text, tspan, textPath').length,
      titleEls: svg.querySelectorAll('title').length,
      viewBox: vb,
      svgBox: { w: Math.round(box.width), h: Math.round(box.height) },
      // Per-piece placement, for TUNING feedback rather than pass/fail:
      // where each fragment actually sits, and whether it has left the frame.
      placement: groups.map((g) => {
        const r = g.getBoundingClientRect();
        return {
          id: g.dataset.logoPiece,
          x: Math.round(r.left - box.left), y: Math.round(r.top - box.top),
          w: Math.round(r.width), h: Math.round(r.height),
          outside: r.right < box.left || r.left > box.right
            || r.bottom < box.top || r.top > box.bottom,
          opacity: getComputedStyle(g).opacity,
        };
      }),
      overlay: (() => {
        const o = document.querySelector('.logo-intro');
        const s = o && getComputedStyle(o);
        return o && { role: o.getAttribute('role'), modal: o.getAttribute('ariaModal') ?? o.getAttribute('aria-modal'), label: o.getAttribute('aria-label'), z: s.zIndex };
      })(),
    };
  });
}

/** Is the hero readable with no scroll, once the intro is done? */
async function heroAtRest(page) {
  return page.evaluate(() => {
    const seen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.top < innerHeight && r.bottom > 0 && r.width > 0
        && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
    };
    const heads = [...document.querySelectorAll('h1, .discover-display, .discover-heading')];
    return {
      scrollY: Math.round(scrollY),
      introPresent: !!document.querySelector('.logo-intro'),
      headingsInFirstViewport: heads.filter(seen).length,
      firstHeading: heads.find(seen)?.innerText.replace(/\s+/g, ' ').slice(0, 70) ?? null,
      ctas: [...document.querySelectorAll('.discover-button, .discover-nav-login')].filter(seen).length,
      navLogoPaths: document.querySelectorAll('.discover-nav .assembly-logo path, .discover-assembly-logo path').length,
      video: (() => {
        const v = document.querySelector('.discover-video, video');
        return v && { paused: v.paused, muted: v.muted, loop: v.loop, autoplay: v.autoplay };
      })(),
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
}

async function stages(browser) {
  const { context, page } = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
  await page.goto(url('logoDebug=1'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.logo-intro__debug input[type=range]', { timeout: 15000 });
  const rows = [];
  for (const s of STAGES) {
    await seek(page, s.t / T);
    const inv = await invariants(page);
    await page.screenshot({ path: `${OUT}/stage-${s.key}.png` });
    rows.push({ stage: s.key, t: s.t, progress: +(s.t / T).toFixed(4), note: s.note, ...inv });
  }
  await context.close();
  return rows;
}

/** Text-node purity has to be measured with debug OFF: debug adds <title>. */
async function purity(browser) {
  const { context, page } = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
  await page.goto(url('logoReplay=1'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.logo-intro', { timeout: 15000 }).catch(() => {});
  const early = await invariants(page);
  await page.waitForTimeout(3200);
  const rest = await heroAtRest(page);
  await context.close();
  return { early, rest };
}

async function widths(browser) {
  const out = [];
  for (const w of [375, 430, 768, 1024, 1440, 1920]) {
    const { context, page } = await newPage(browser, { motion: true, viewport: { width: w, height: Math.round(w * 0.62) + 300 } });
    await page.goto(url('logoDebug=1'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.logo-intro__debug input[type=range]', { timeout: 15000 }).catch(() => {});
    await seek(page, 1.72 / T);
    const settled = await invariants(page);
    await page.screenshot({ path: `${OUT}/w${w}-assembled.png` });
    await seek(page, 1);
    await page.waitForTimeout(400);
    const rest = await heroAtRest(page);
    await page.screenshot({ path: `${OUT}/w${w}-rest.png` });
    out.push({ width: w, markW: settled.svgBox?.w, markH: settled.svgBox?.h, paths: settled.paths, ...rest });
    await context.close();
  }
  return out;
}

/**
 * Lifecycle. Each case gets its OWN context, because once-per-session lives in
 * sessionStorage and a shared context would silently contaminate the result.
 */
async function lifecycle(browser) {
  const out = {};

  // once-per-session — must NOT use logoReplay, which forces a replay.
  {
    const { context, page } = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
    await page.goto(url(), { waitUntil: 'domcontentloaded' });
    const first = !!(await page.$('.logo-intro'));
    await page.waitForTimeout(3200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const second = !!(await page.$('.logo-intro'));
    const key = await page.evaluate(() => {
      try { return sessionStorage.getItem('playerone:logo-assembly:v1'); } catch { return 'THREW'; }
    });
    await context.close();
    const fresh = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
    await fresh.page.goto(url(), { waitUntil: 'domcontentloaded' });
    const newSession = !!(await fresh.page.$('.logo-intro'));
    await fresh.context.close();
    out.oncePerSession = { firstVisit: first, afterReload: second, newContext: newSession, storageKey: key };
  }

  // reduced motion — page must be immediately final, no intro at all.
  {
    const { context, page } = await newPage(browser, { viewport: { width: 1440, height: 900 } }); // reduce is the default
    const movies = [];
    page.on('request', (r) => { if (/\.(mp4|webm)(\?|$)/.test(r.url())) movies.push(r.url()); });
    await page.goto(url('logoReplay=1'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    out.reducedMotion = { introPresent: !!(await page.$('.logo-intro')), movieRequests: movies.length, ...(await heroAtRest(page)) };
    await page.screenshot({ path: `${OUT}/reduced-motion.png` });
    await context.close();
  }

  // Escape, resize and route change must each restore scroll AND focus.
  for (const [name, act] of [
    ['escape', async (p) => { await p.keyboard.press('Escape'); }],
    ['resize', async (p) => { await p.setViewportSize({ width: 900, height: 700 }); }],
    ['route', async (p) => { await p.evaluate(() => history.pushState({}, '', '/discover#work')); await p.goto(new URL('/', BASE).toString(), { waitUntil: 'domcontentloaded' }); }],
  ]) {
    const { context, page } = await newPage(browser, { motion: true, viewport: { width: 1440, height: 900 } });
    await page.goto(url('logoReplay=1'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.logo-intro', { timeout: 15000 }).catch(() => {});
    const locked = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    }));
    await act(page).catch(() => {});
    await page.waitForTimeout(900);
    out[name] = {
      duringIntro: locked,
      after: await page.evaluate(() => ({
        introPresent: !!document.querySelector('.logo-intro'),
        bodyOverflow: getComputedStyle(document.body).overflow,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
        canScroll: (() => { const y0 = scrollY; scrollTo(0, 400); const moved = scrollY !== y0; scrollTo(0, y0); return moved; })(),
        activeEl: document.activeElement?.className || document.activeElement?.tagName || null,
        activeInDetachedIntro: !!document.activeElement?.closest?.('.logo-intro'),
      })),
    };
    await context.close();
  }
  return out;
}

const CMD = process.argv[2] ?? 'all';
const run = { stages, purity, widths, lifecycle };

await withBrowser(async (browser) => {
  const result = {};
  for (const [name, fn] of Object.entries(run)) {
    if (CMD !== 'all' && CMD !== name) continue;
    try { result[name] = await fn(browser); }
    catch (e) { result[name] = { FAILED: String(e).slice(0, 300) }; }
  }
  console.log(JSON.stringify(result, null, 1));
});
