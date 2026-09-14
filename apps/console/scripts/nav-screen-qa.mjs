/**
 * The navigation dock's proof, and it measures rather than asserts a feeling.
 *
 * Five scenarios per viewport, each one a clause of the requirement:
 *
 *   down      scrolling down closes the dock
 *   up        scrolling up opens it
 *   approach  a cursor walking up from 300px below in 20px steps opens it
 *             *before* it arrives — the interesting number is the dock's open
 *             fraction at each step, not the end state
 *   focus     Tab into the dock opens it, and the collapsed links are inert
 *   still     under `prefers-reduced-motion` every state change is one step
 *
 * Two passes, because they cannot share a run. The geometry pass samples
 * `--nav-open` and the pill's visible box on every animation frame, which is
 * the only way to see the spring's overshoot and the frame gaps; screenshots
 * cost 100-300ms each and would become the thing being measured. The frame
 * pass then writes PNGs at named moments.
 *
 * The one hard assertion beyond direction: the reveal control must stay inside
 * the pill at the deepest frame of the collapse. The spring undershoots by
 * about 4%, the clip follows it, and `--nav-collapsed` is sized for exactly
 * that headroom — a tighter footprint clips the only control a collapsed dock
 * offers, and no static screenshot would ever show it.
 *
 *   CONSOLE_URL=http://127.0.0.1:5190 node apps/console/scripts/nav-screen-qa.mjs
 */
import { withBrowser, newPage } from './browser.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';
const OUT = process.env.NAV_SHOTS ?? 'C:/build/console-nav-shots';
mkdirSync(OUT, { recursive: true });

/** The dock's live numbers, read off the DOM rather than inferred. */
const STATE = String.raw`()=>{
  const wrap=document.querySelector('.discover-nav-wrap');
  const nav=document.querySelector('.discover-nav');
  const reveal=document.querySelector('.discover-nav-reveal');
  const box=nav.getBoundingClientRect();
  const hidden=parseFloat(getComputedStyle(nav).clipPath.match(/inset\(0px ([-0-9.]+)px/)?.[1]??'0');
  return {
    open:parseFloat(wrap.style.getPropertyValue('--nav-open')),
    collapsed:wrap.dataset.collapsed,
    pillLeft:box.left,pillRight:box.right-hidden,pillWidth:box.width-hidden,
    revealRight:reveal.getBoundingClientRect().right,
  };
}`;

/** Every animation frame plus every long task, for one window of time. */
const RECORD = `(ms)=>new Promise(done=>{
  const read=${STATE};
  const frames=[],tasks=[];
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:+entry.startTime.toFixed(1),duration:+entry.duration.toFixed(1)});});
  try{observer.observe({entryTypes:['longtask']});}catch{}
  const start=performance.now();
  const step=now=>{
    const s=read();
    frames.push({t:+(now-start).toFixed(1),open:s.open,pillWidth:+s.pillWidth.toFixed(1),revealRight:+s.revealRight.toFixed(1),pillRight:+s.pillRight.toFixed(1)});
    if(now-start<ms)requestAnimationFrame(step);else{observer.disconnect();done({frames,tasks});}
  };
  requestAnimationFrame(step);
})`;

/** Frame pacing, so "drops no frames" is a number and not an opinion. */
function pacing(frames) {
  const gaps = frames.slice(1).map((f, i) => +(f.t - frames[i].t).toFixed(1));
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    frames: frames.length,
    medianGap: sorted[sorted.length >> 1] ?? 0,
    worstGap: sorted.at(-1) ?? 0,
    over32ms: gaps.filter((g) => g > 32).length,
  };
}

async function open(browser, width, motion) {
  const { page, context } = await newPage(browser, { viewport: { width, height: 900 }, motion });
  await page.addInitScript(() => localStorage.setItem('playerone.locale', 'en'));
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  /* Park the pointer well clear of the corridor, then leave the top of the
     document so the dock has something to get out of the way of. */
  await page.mouse.move(width / 2, 800);
  await page.evaluate(() => scrollTo(0, 600));
  await page.waitForTimeout(700);
  return { page, context };
}

const report = [];

await withBrowser(async (browser) => {
  for (const width of [1440, 390]) {
    const tag = `${width}`;
    const { page, context } = await open(browser, width, true);
    const state = () => page.evaluate(`(${STATE})()`);
    const record = (ms) => page.evaluate(`(${RECORD})(${ms})`);

    /* 1. scrolling down closes the dock. */
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(600);
    assert.equal((await state()).collapsed, 'false', 'at the top the dock is open');
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-01-open-at-top.png` });
    let run = record(900);
    await page.waitForTimeout(60);
    await page.evaluate(() => scrollTo(0, 700));
    const down = await run;
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-02-closed-after-scroll-down.png` });
    const after = await state();
    assert.equal(after.collapsed, 'true', 'scrolling down closes the dock');
    const wide = down.frames[0].pillWidth;
    const narrow = after.pillWidth;
    assert(narrow < wide - 60, `the dock must visibly contract (${wide} -> ${narrow})`);
    /* The deepest frame of the collapse is the spring's undershoot. */
    const deepest = down.frames.reduce((a, b) => (b.pillWidth < a.pillWidth ? b : a));
    assert(
      deepest.revealRight <= deepest.pillRight,
      `the reveal control must stay inside the pill at the deepest frame (reveal ${deepest.revealRight} > pill ${deepest.pillRight})`,
    );
    const overshootPercent = +(((narrow - deepest.pillWidth) / narrow) * 100).toFixed(1);

    /* 2. scrolling up opens it. */
    run = record(900);
    await page.waitForTimeout(60);
    await page.evaluate(() => scrollBy(0, -260));
    const up = await run;
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-03-open-after-scroll-up.png` });
    assert.equal((await state()).collapsed, 'false', 'scrolling up opens the dock');

    /* 3. the approach: 300px below the dock, 20px at a time. */
    await page.mouse.move(width / 2, 800);
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(700);
    assert.equal((await state()).collapsed, 'true', 'the dock is closed before the approach');
    const edge = await page.evaluate(() => document.querySelector('.discover-nav-wrap').getBoundingClientRect().bottom);
    const approach = [];
    for (let y = Math.round(edge) + 300; y >= Math.round(edge) - 10; y -= 20) {
      await page.mouse.move(width / 2, Math.max(1, y));
      await page.waitForTimeout(120);
      const s = await state();
      const distance = Math.round(y - edge);
      approach.push({ distance, open: s.open, pillWidth: +s.pillWidth.toFixed(1) });
      for (const mark of [100, 60, 20])
        if (Math.abs(distance - mark) < 10)
          await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-04-approach-${mark}px-away.png` });
    }
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-05-open-on-arrival.png` });
    const at = (d) => approach.find((s) => s.distance === d);
    assert(at(140)?.open === 0, `the corridor starts at 140px, not before (open ${at(140)?.open})`);
    assert(at(100)?.open > 0.02, `the dock has begun opening 100px out (open ${at(100)?.open})`);
    assert(at(40)?.open > 0.8, `the dock is nearly open 40px out (open ${at(40)?.open})`);
    /* The proximity target is already 1 by 28px out; the residual here is the
       spring closing its last percent, measured 120ms after the step. */
    assert(at(20)?.open > 0.97, `the dock has all but finished 20px out, before the cursor arrives (open ${at(20)?.open})`);
    assert.equal((await state()).collapsed, 'false', 'the dock is open when the cursor arrives');

    /* 4. Tab into the dock, and the collapsed links are not reachable first. */
    await page.mouse.move(width / 2, 800);
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(700);
    assert.equal((await state()).collapsed, 'true', 'the dock is closed before the Tab');
    assert.equal(
      await page.locator('.discover-nav-expanded').evaluate((n) => n.inert),
      true,
      'collapsed links are inert',
    );
    run = record(900);
    await page.waitForTimeout(60);
    for (let press = 0; press < 8; press++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.querySelector('.discover-nav-wrap').contains(document.activeElement))) break;
    }
    const focus = await run;
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-06-open-after-tab.png` });
    assert.equal((await state()).collapsed, 'false', 'focus inside the dock opens it');
    const focusLandedOn = await page.evaluate(() => document.activeElement?.className ?? '');

    /* Astra's transfer, kept: focusing the reveal control hands the keyboard
       to the links it just uncovered. Tab never reaches it in practice — the
       brand comes first and opening on focus makes the links tabbable again —
       so it is only ever entered programmatically or by assistive technology,
       and it is asserted here because nothing else exercises it. */
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(width / 2, 800);
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(700);
    await page.locator('.discover-nav-reveal').focus();
    await page.waitForTimeout(200);
    assert(
      await page.locator('.discover-nav-expanded').evaluate((n) => n.contains(document.activeElement)),
      'the reveal control transfers the keyboard into the expanded navigation',
    );

    /* 5. the reveal control by pointer, and Escape on the mobile menu. */
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(width / 2, 800);
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(700);
    /* A touch pointermove must NOT open the dock: there is no hover on a
       phone, so proximity would fire on the tap itself and the reveal control
       would never be the thing that opened anything. */
    await page.evaluate(() =>
      dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: innerWidth / 2, clientY: 40, bubbles: true })),
    );
    await page.waitForTimeout(300);
    assert.equal((await state()).collapsed, 'true', 'a touch pointermove leaves the dock closed');
    /* Dispatched rather than clicked, and that is the finding: a *pointer*
       approaching this control opens the dock before it can be hit, and the
       links take its place. It is reachable by touch, by the keyboard and by
       assistive technology, which are the three callers that need it. */
    await page.locator('.discover-nav-reveal').dispatchEvent('click');
    await page.waitForTimeout(700);
    assert.equal((await state()).collapsed, 'false', 'the reveal control opens the dock');
    await page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-07-open-after-reveal-click.png` });
    if (width === 390) {
      await page.locator('.discover-menu-button').click();
      assert(await page.locator('#discover-menu').evaluate((n) => n.open), 'the mobile menu opens');
      assert.equal((await state()).collapsed, 'false', 'an open menu holds the dock open');
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#discover-menu').evaluate((n) => n.open)), 'Escape closes the mobile menu');
    }
    /* No sideways scroll: the fault rhythm.mjs names first, and the one a dock
       that changes its own footprint is most likely to cause. */
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      0,
      'no sideways scroll',
    );

    report.push({
      width,
      collapsedWidth: narrow,
      expandedWidth: wide,
      overshootPercent,
      focusLandedOn,
      approach,
      pacing: { down: pacing(down.frames), up: pacing(up.frames), focus: pacing(focus.frames) },
      longTasks: { down: down.tasks, up: up.tasks, focus: focus.tasks },
    });
    await context.close();

    /* 6. reduced motion: every change is one step, and no spring ever runs. */
    const quiet = await open(browser, width, false);
    const stillRun = quiet.page.evaluate(`(${RECORD})(900)`);
    await quiet.page.waitForTimeout(60);
    await quiet.page.evaluate(() => scrollTo(0, 0));
    await quiet.page.waitForTimeout(300);
    await quiet.page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-08-reduced-motion-open.png` });
    const opened = await quiet.page.evaluate(`(${STATE})()`);
    await quiet.page.evaluate(() => scrollTo(0, 700));
    await quiet.page.waitForTimeout(400);
    await quiet.page.locator('.discover-nav-wrap').screenshot({ path: `${OUT}/${tag}-09-reduced-motion-closed.png` });
    const shut = await quiet.page.evaluate(`(${STATE})()`);
    const interpolated = (await stillRun).frames.map((f) => f.open).filter((v) => v > 0.001 && v < 0.999);
    assert.equal(opened.collapsed, 'false', 'reduced motion still opens at the top');
    assert.equal(shut.collapsed, 'true', 'reduced motion still closes on the way down');
    assert.equal(interpolated.length, 0, `reduced motion must not interpolate (saw ${interpolated.slice(0, 5)})`);
    report.push({
      width,
      reducedMotion: { openedAt: opened.open, closedAt: shut.open, interpolatedFrames: interpolated.length },
    });
    await quiet.context.close();
  }

  /* Astra's second loop, kept in intent: the expanded dock must still fit at
     every width in every language. Vietnamese runs about 20% longer than
     English, and a dock that overflows only in Vietnamese is one nobody
     measured. */
  for (const [width, locale] of [
    [1280, 'vi'],
    [1024, 'vi'],
    [900, 'en'],
    [768, 'zh'],
    [390, 'vi'],
    [320, 'vi'],
  ]) {
    const { page, context } = await newPage(browser, { viewport: { width, height: 900 }, motion: false });
    await page.addInitScript((lang) => localStorage.setItem('playerone.locale', lang), locale);
    await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const nav = page.locator('.discover-nav');
    await nav.locator('a.discover-brand').focus();
    await page.waitForTimeout(200);
    assert.equal(await nav.evaluate((n) => n.scrollWidth - n.clientWidth), 0, `the expanded dock fits ${width} ${locale}`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      0,
      `no sideways scroll at ${width} ${locale}`,
    );
    report.push({ width, locale, navFit: 'passed' });
    await context.close();
  }
});

writeFileSync(`${OUT}/results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nframes and results in ${OUT}`);
