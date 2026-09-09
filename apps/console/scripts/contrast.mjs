/**
 * The contrast probe, rendered-pixel based, kept from the previous pass.
 *
 * Two techniques, both of which exist because the obvious version was wrong:
 *
 * 1. **Ink under glyphs is measured by differencing.** Render the element,
 *    render it again with its glyphs made transparent, and the pixels that
 *    changed are exactly the pixels the letters cover. Measuring the ink over
 *    the element's *bounding box* averages in all the ground between the
 *    letters and reports a ratio nobody experiences.
 *
 * 2. **A control's boundary takes the best contrast the control offers.** For
 *    every pixel of ground the control touches, find the highest ratio any
 *    part of the control reaches against it, and score the control by the
 *    worst of those. Measuring fill-vs-ground alone scored an outlined button
 *    at 1.00:1 — its fill IS the ground; the outline is what identifies it.
 *
 * Run against the dev server, no database:
 *   CONSOLE_URL=http://127.0.0.1:5190 node apps/console/scripts/contrast.mjs
 *
 * It reports; it does not assert. `packages/design/test/contrast.test.ts` is
 * where a ratio becomes a rule — that file holds token pairs and needs no
 * browser. This one measures what a rendered page actually composites, which
 * is the only way to catch a control whose ground is decided by something
 * painted behind it.
 */
import { chromium } from 'playwright';
import { acquireLock, guard } from './browser.mjs';

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';

/**
 * Whether the one motion-enabled pass runs. `CONTRAST_MOTION=0` turns it off.
 *
 * Exactly one of the twelve passes below renders with motion — light at 1440,
 * because the cursor's intermediate frames are a composite that only exists
 * while the lens is growing. That pass is also the only expensive one: the
 * page runs a permanent GSAP ticker, headless Chrome does not vsync-throttle
 * `requestAnimationFrame`, and a page left open with motion on pins a core for
 * as long as it lives. On a shared machine with other agents working, that
 * page gets killed — twice in a row here, at the same point in the run, taking
 * every static measurement after it with it.
 *
 * So it is a switch rather than an argument about whether the measurement is
 * worth having. It is: leave it on by default. Turn it off when the machine is
 * busy, and say in the report that the lens was not re-measured.
 */
const MOTION = process.env.CONTRAST_MOTION !== '0';

/**
 * The slice to measure, so a re-run after one fix is seconds rather than eight
 * minutes.
 *
 * Twelve passes over two routes is the right default and a poor debugging
 * loop: on a shared machine this run was killed twice mid-walk and lost every
 * measurement after the kill, and re-running the whole thing to recover four
 * numbers is how a probe stops being run at all.
 *
 *   THEMES=light SIZES=1440x900 ROUTES=/discover node scripts/contrast.mjs
 */
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
const SIZES = (process.env.SIZES ?? '1440x900,1280x720,390x844')
  .split(',')
  .map((s) => s.split('x').map(Number));
const ROUTES = (process.env.ROUTES ?? '/login,/discover').split(',');

const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');

/**
 * A clip of the live page, decoded to raw RGBA.
 *
 * The decode happens in the page rather than in Node: `pngjs` is not a
 * dependency of this repo and adding one to run a probe would be the tail
 * wagging the dog. `createImageBitmap` is already in every browser this
 * console supports.
 */
async function grab(page, box) {
  const buf = await page.screenshot({
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.w),
      height: Math.round(box.h),
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

/**
 * Technique 1. `ratio` is the element's own ink against the mean composited
 * ground under its glyphs, and `covered` is how many pixels the letters own —
 * a count near zero means the selector found something with no visible text
 * and the ratio is not about anything.
 */
async function inkRatio(page, selector, index = 0) {
  const handle = page.locator(selector).nth(index);
  /* Centre it, rather than merely bring it into view: `scrollIntoViewIfNeeded`
     is happy to leave an element tucked under the sticky bar, and a clip that
     includes the bar measures the bar. */
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const box = await handle.boundingBox();
  if (box === null || box.width < 2 || box.height < 2) return null;
  const clip = { x: box.x, y: box.y, w: Math.min(box.width, 900), h: Math.min(box.height, 200) };

  const before = await grab(page, clip);
  const ink = await handle.evaluate((el) => getComputedStyle(el).color);
  /*
   * `transition: none` first, and leaving it out was the probe's own bug.
   *
   * `color` is in `button.tsx`'s transition list at 150ms, so setting the ink
   * transparent started a fade and the second screenshot caught it halfway.
   * Every measured ground came back a mid grey and the submit's label reported
   * 4.09:1 against a pair that is 15.74:1. The difference is entirely in the
   * probe.
   */
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

  /*
   * Only the pixels a glyph FULLY owns.
   *
   * The first version took every pixel that changed, which is the glyph plus
   * its antialiased rim — and on 13px type the rim outnumbers the core. The
   * mean it produced was halfway between the ink and the ground, so a white
   * label on a near-black pill reported 5.9:1 when the pair is 15.8:1. A pixel
   * is counted here only when the lit render is within 24 per channel of the
   * declared ink, which is the definition of "covered".
   */
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
  if (n === 0) return null;
  const ground = sum.map((v) => v / n);
  return { ratio: ratio(inkRgb, ground), ground: hex(ground), ink: hex(inkRgb), covered: n };
}

/**
 * Technique 2. The ring is the ground the control touches; the interior is
 * every part of the control. Colours are quantised to 8 levels per channel so
 * this is a few hundred comparisons rather than a few million, which does not
 * move a ratio at the precision anybody reports it to.
 */
async function boundaryRatio(page, selector, index = 0) {
  const handle = page.locator(selector).nth(index);
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const box = await handle.boundingBox();
  if (box === null || box.width < 4 || box.height < 4) return null;
  /*
   * Four pixels of pad, of which only the outer two are ground and only what
   * starts two pixels inside the box is control.
   *
   * The seam between them is thrown away, and that is not tidiness. A button
   * whose layout puts it at y=379.5625 has an antialiased top row that is
   * half ground and half fill; measured as ground it is a mid grey that
   * belongs to neither, and it dragged the primary call to action from 12.97:1
   * to 4.50:1 at 390px while the very same control measured 12.97:1 at 1440px,
   * where the layout happened to land on a whole pixel. The control did not
   * change between those two numbers; only the subpixel offset did.
   *
   * The skip is asymmetric on purpose. Two pixels were thrown away on the
   * inside as well at first, and that excluded the one thing a text field has:
   * its 1px border. `--field-border` stopped being measured and the score came
   * off the curve of the corner radius instead. A control starts one pixel
   * inside its own box.
   */
  const pad = 5;
  /** Ground is the outer three rows: 5, 4 and 3 pixels clear of the box. */
  const ringDepth = 3;
  /** The control starts one pixel inside its own box, so a 1px border counts. */
  const innerSkip = 1;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    w: Math.min(box.width + pad * 2, 900),
    h: Math.min(box.height + pad * 2, 400),
  };
  const png = await grab(page, clip);
  /* Bucket for speed, but keep the first REAL colour in each bucket: rounding
     a colour to the middle of its bucket moves it by up to 16 per channel,
     which is enough to move a ratio, and the point of this probe is that the
     numbers come off the rendered pixels. */
  const key = (c) => `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;

  const inner = new Map();
  const ring = new Map();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const outer =
        x < ringDepth ||
        y < ringDepth ||
        x >= png.width - ringDepth ||
        y >= png.height - ringDepth;
      const deep =
        x >= pad + innerSkip &&
        y >= pad + innerSkip &&
        x < png.width - pad - innerSkip &&
        y < png.height - pad - innerSkip;
      const c = at(png, x, y);
      if (outer) {
        if (!ring.has(key(c))) ring.set(key(c), c);
      } else if (deep) {
        if (!inner.has(key(c))) inner.set(key(c), c);
      }
    }
  }
  let worst = Infinity;
  let worstPair = null;
  for (const g of ring.values()) {
    let best = 0;
    let bestC = null;
    for (const c of inner.values()) {
      const r = ratio(g, c);
      if (r > best) {
        best = r;
        bestC = c;
      }
    }
    if (best < worst) {
      worst = best;
      worstPair = [hex(g), hex(bestC ?? [0, 0, 0])];
    }
  }
  return { ratio: worst, ground: worstPair?.[0], control: worstPair?.[1] };
}

const TEXT = {
  '/login': [
    ['h1 (ink block)', 'h1'],
    ['eyebrow on ink', 'header + main p'],
    ['intro on ink', '.feature-block p:last-of-type'],
    ['legend', 'fieldset legend', 0],
    ['field label', 'label > span', 0],
    ['segment on', 'label:has(input[value=operator])'],
    ['segment off', 'label:has(input[value=reviewer])'],
    ['submit label', 'button[type=submit]'],
    ['legal line', 'main > div > div > span', 0],
    ['legal link', 'a[href="#privacy"]'],
  ],
  /* -----------------------------------------------------------------------
     Build seven, 2026-09-08. The bands are named with `data-band`, so a
     selector here survives a change of composition — which is the whole
     reason those attributes exist, and the previous list still proved it was
     needed: six of its rows timed out against a page that no longer has a
     four-step strip, a `[data-band=number]` or a `mark.marker`.

     **Nothing here is inside a `lg:` breakpoint.** The floating chips over
     the headline are `hidden` below 1024px, and a display:none element has no
     box to clip, so measuring one would ERR at 390 on every run. Their two
     pairs — `--warn` on `--warn-bg`, and each verdict ink on its own fill —
     are held by `packages/design/test/contrast.test.ts`, which needs no
     browser and covers both schemes.
     -------------------------------------------------------------------- */
  '/discover': [
    ['hero eyebrow (mono)', '[data-band=hero] p', 0],
    ['h1 line', '[data-band=hero] h1 span', 2],
    ['hero lead', '[data-band=hero] p', 1],
    ['apk note', '[data-band=hero] p', 2],
    ['work micro', '[data-band=work] p', 0],
    ['work h2', '[data-band=work] h2'],
    ['work body', '[data-band=work] p', 1],
    ['work note (13px)', '[data-band=work] p', 2],
    ['still caption on film', '[data-band=camera] figcaption'],
    ['camera h2 on lavender', '[data-band=camera] h2'],
    ['camera body on lavender', '[data-band=camera] .frame-grid p', 1],
    ['film micro on film', '[data-band=film] p', 0],
    ['film slate on film', '[data-band=film] p', 1],
    ['review micro on ink', '[data-band=review] p', 0],
    ['review h2 on ink', '[data-band=review] h2'],
    ['review body on ink', '[data-band=review] p', 1],
    ['verdict label on ink', '[data-band=review] span span', 1],
    ['verdict note on ink', '[data-band=review] p', 2],
    ['payment micro', '[data-band=payment] p', 0],
    ['payment h2', '[data-band=payment] h2'],
    ['payment body', '[data-band=payment] p', 1],
    ['stream label (mono)', '[data-band=payment] figure span', 0],
    ['payable caption', '[data-band=payment] figcaption'],
    ['faq micro', '[data-band=questions] p', 0],
    ['faq question', 'details summary', 0],
    ['faq answer', 'details p', 0],
    ['closing micro on ink', '[data-band=ways] p', 0],
    ['closing h2 on ink', '[data-band=ways] h2'],
    ['audiences on ink', '[data-band=ways] p', 1],
    ['take body on ink', '[data-band=ways] p', 2],
    ['partner line on ink', '[data-band=ways] p span'],
    ['nav destination (mono)', 'header nav a', 0],
    ['nav sign-in label', 'header a[href="/login"]'],
    ['nav partner line', 'header span span', 1],
    ['credits link', 'footer a'],
  ],
  /* The not-found route. Three rows, because it has three pieces of text and
     the falling field is `aria-hidden` decoration with no type in it. */
  '/nope': [
    ['nf eyebrow (mono)', 'main p', 0],
    ['nf h1 line', 'main h1 span', 1],
    ['nf body', 'main p', 1],
  ],
};

const CONTROLS = {
  '/login': [
    ['text field', 'input[name=machine_identifier]'],
    ['segmented track', 'div[role=presentation]'],
    ['submit', 'button[type=submit]'],
  ],
  '/discover': [
    ['nav destination link', 'header nav a', 0],
    ['nav sign-in pill', 'header a[href="/login"]'],
    /*
     * The hero's two peers, on the lavender ground rather than on footage
     * from this build on: the film is spent once, further down, and the hero
     * is type. The APK control is `outline` and `disabled` while the build is
     * unpublished, at full opacity — a disabled control still has to be
     * identifiable against its ground under WCAG 1.4.11, and an earlier
     * build's faded `primary` read as *more* available than the live sign-in
     * in dark mode.
     */
    ['hero apk CTA (disabled)', '[data-band=hero] button[disabled]'],
    ['hero console CTA', '[data-band=hero] a[href="/login"]'],
    ['film pause control', '[data-band=film] button'],
    ['faq row (glass)', 'details', 0],
    ['closing sign-in on ink', '[data-band=ways] a[href="/login"]'],
    ['closing apk (disabled)', '[data-band=ways] button[disabled]'],
  ],
  '/nope': [['back to product page', 'main a[href="/discover"]']],
};

/**
 * The film's worst frame, which is the only honest way to measure this page.
 *
 * Film First puts the slogan, the lead sentence, both calls to action and the
 * note under them **on moving footage**. Every earlier build's contrast work
 * assumed a static ground, and the poster is not the answer either: it is one
 * frame out of 169, and it is the darkest kind — the whole point is what
 * happens when a bright one arrives under the type.
 *
 * So the video is paused, seeked across its own duration, and the type is
 * measured at each stop with the same glyph-differencing technique everything
 * else here uses. The last row removes the element entirely and measures the
 * grade over bare `--stage`, which is what a reader with a blocked, failed or
 * still-loading video sees; that row and the frame rows have to clear the same
 * bar, because a page whose type is only legible once the video arrives is a
 * page that is illegible for its first second.
 *
 * `seeked` rather than a timeout: a `currentTime` assignment is asynchronous
 * and a screenshot taken before the decoder catches up measures the frame
 * before it.
 */
async function filmFrames(page) {
  const has = await page.locator('[data-band=film] video').count();
  if (has === 0) {
    console.log('  FILM  (no film band on this route)');
    return;
  }

  const seek = (t) =>
    page.evaluate(async (time) => {
      const v = document.querySelector('[data-band=film] video');
      if (v === null) return null;
      v.pause();
      if (!Number.isFinite(v.duration)) {
        await new Promise((r) => {
          v.addEventListener('loadedmetadata', r, { once: true });
          setTimeout(r, 3000);
        });
      }
      const target = Math.min(time, Math.max(0, (v.duration || 7) - 0.05));
      if (Math.abs(v.currentTime - target) < 0.01) return v.currentTime;
      await new Promise((r) => {
        v.addEventListener('seeked', r, { once: true });
        v.currentTime = target;
        setTimeout(r, 3000);
      });
      return v.currentTime;
    }, t);

  /*
   * Two rows now and not four, because the film no longer carries the
   * headline. Build seven spends it once, in a band of its own, and the only
   * type on it is the mono label that says *placeholder film* and the slate
   * that says what the film is. Both sit inside `.film-grade`'s heaviest
   * region, which is where the ramp reaches 0.88–1.0 of `--stage`.
   */
  const ON_FILM = [
    ['film micro', '[data-band=film] p', 0],
    ['film slate', '[data-band=film] p', 1],
  ];

  await page.evaluate(() => window.scrollTo(0, 0));
  /* Six stops across 7.04 s, plus the poster, plus no video at all. */
  for (const t of [0, 1.2, 2.4, 3.6, 4.8, 6.9]) {
    const at = await seek(t);
    if (at === null) return;
    const parts = [];
    for (const [label, sel, i = 0] of ON_FILM) {
      const r = await inkRatio(page, sel, i);
      parts.push(`${label} ${r === null ? '   n/a' : `${r.ratio.toFixed(2)}:1 on ${r.ground}`}`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    console.log(`  FILM  t=${at.toFixed(2)}s  ${parts.join('  |  ')}`);
  }

  /* The video gone: the grade over `--stage`, which is the loading and the
     blocked case, and the floor every frame above has to beat. */
  await page.evaluate(() => {
    const v = document.querySelector('[data-band=hero] video');
    if (v !== null) v.hidden = true;
  });
  await page.waitForTimeout(200);
  const parts = [];
  for (const [label, sel, i = 0] of ON_FILM) {
    const r = await inkRatio(page, sel, i);
    parts.push(`${label} ${r === null ? '   n/a' : `${r.ratio.toFixed(2)}:1 on ${r.ground}`}`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  console.log(`  FILM  no video   ${parts.join('  |  ')}`);
  await page.evaluate(() => {
    const v = document.querySelector('[data-band=hero] video');
    if (v !== null) v.hidden = false;
  });
}

/**
 * The cursor's worst frame, and why the endpoints are not enough.
 *
 * `components/CustomCursor.tsx` reveals a clone of the hovered control in
 * `--lime-500` through a radial mask, inside a disc of `--stage`. At rest and
 * at full size that pair is 13.5:1. **In between it is a different pair**: the
 * disc eases from 12px to 140px over about fifteen frames, and if the mask does
 * not ease with it, accent type lands on the near-white page for a fifth of a
 * second at roughly 1.6:1.
 *
 * So this samples the live composite at five points across the growth and
 * reports, for each, the worst contrast between a lime pixel and any colour
 * within three pixels of it that is not lime. It is a pixel probe and not a
 * token pair, because the fault it is looking for exists only in the composite.
 *
 * It measures the light scheme at 1440 only: the disc is `--stage` and the
 * accent is `--lime-500`, and neither changes with the scheme, so the dark
 * ground is the easier case and the wide viewport is where the lens has room.
 */
async function cursorFrames(page) {
  const target = page.locator('header a[href="/login"]').first();
  const box = await target.boundingBox();
  if (box === null) return;
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  /* Two moves: the first arms `mousemove`, the second is the one being timed. */
  await page.mouse.move(cx - 200, cy);
  await page.mouse.move(cx, cy);

  const R = 90;
  for (const t of [50, 100, 150, 250, 500]) {
    await page.waitForTimeout(50);
    /*
     * The clip is clamped at the viewport edge, so the pointer is not at the
     * centre of the image. Written without this the radii were nonsense and
     * every finding was attributed to the wrong part of the disc.
     */
    const clipX = Math.max(0, cx - R);
    const clipY = Math.max(0, cy - R);
    const px = cx - clipX;
    const py = cy - clipY;
    const png = await grab(page, { x: clipX, y: clipY, w: R * 2, h: R * 2 });

    /*
     * Two classifications, and getting them wrong is how this probe lied twice.
     *
     * `core` is a pixel of the accent itself. `ground` is a pixel of the PAGE:
     * bright and near-neutral. Distance from lime does not work as the second
     * test — a glyph's antialiased rim is lime blended halfway into the ink and
     * sits well outside any sensible lime band, so the first version reported
     * 1.08:1 for a letter measured against its own edge. Lime is bright but far
     * from neutral, and so is every blend of lime with `--stage`, which is what
     * makes the channel spread the test that separates them.
     *
     * Two numbers come out. `worst` is over every accent pixel in the clip and
     * will always find the mask's own two-pixel feather, where the reveal fades
     * out by design. `inside` is restricted to the body of the reveal, and it
     * is the one that answers the question: does accent type ever land on the
     * page rather than on the ink?
     */
    const core = (c) =>
      Math.max(Math.abs(c[0] - 0xb8), Math.abs(c[1] - 0xf0), Math.abs(c[2] - 0x4a)) < 40;
    const ground = (c) => Math.max(...c) - Math.min(...c) < 30 && lum(c) > 0.35;

    let worst = Infinity;
    let worstPair = null;
    let worstAt = 0;
    let inside = Infinity;
    let insidePair = null;
    let lit = 0;
    let body = 0;
    for (let y = 5; y < png.height - 5; y += 1) {
      for (let x = 5; x < png.width - 5; x += 1) {
        const c = at(png, x, y);
        if (!core(c)) continue;
        lit += 1;
        const rad = Math.hypot(x - px, y - py);
        if (rad < 55) body += 1;
        for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
          const n = at(png, x + dx, y + dy);
          if (!ground(n)) continue;
          const r = ratio(c, n);
          if (r < worst) {
            worst = r;
            worstPair = [hex(c), hex(n)];
            worstAt = Math.round(rad);
          }
          if (rad < 55 && r < inside) {
            inside = r;
            insidePair = [hex(c), hex(n)];
          }
        }
      }
    }

    const head = `  LENS  t+${String(t).padStart(3)}ms  `;
    if (lit === 0) {
      console.log(`${head}(no accent pixels yet)`);
    } else {
      const edge =
        worstPair === null
          ? 'never beside the page'
          : `${worst.toFixed(2)}:1 ${worstPair[0]} on ${worstPair[1]} at r=${worstAt}`;
      const core55 =
        insidePair === null
          ? 'never beside the page'
          : `${inside.toFixed(2)}:1 ${insidePair[0]} on ${insidePair[1]}`;
      console.log(`${head}edge ${edge}  |  body (r<55) ${core55}  (${lit}px lit, ${body} in body)`);
    }
  }
  await page.mouse.move(4, 4);
}

/*
 * One browser on this machine at a time, and closed on every exit path.
 * Three of these scripts run from different panes with no coordination;
 * together they saturated the box at 70-80% CPU and cost one run four
 * measurements to a 30s screenshot timeout caused purely by contention.
 * A throw between here and the close used to leak the browser outright.
 */
const releaseLock = await acquireLock();
const browser = await chromium.launch();
guard(browser, releaseLock);

for (const theme of THEMES) {
  for (const [w, h] of SIZES) {
    /*
     * Motion is off everywhere except the one pass that measures it.
     *
     * `cursorFrames` below is the exception and it is deliberate: the lens is
     * the page's signature and its intermediate frames are what have to be
     * proved. Everywhere else the ink and the ground are static facts, reduced
     * motion renders them at rest, and it stops the page's own rAF loops from
     * spinning a core through two hundred screenshots.
     */
    const measuringMotion = MOTION && theme === 'light' && w === 1440;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      reducedMotion: measuringMotion ? 'no-preference' : 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => localStorage.setItem('playerone.theme', t), theme);

    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
      /*
       * Wait for the choreography to exist BEFORE walking the page.
       *
       * `useChoreography` imports GSAP dynamically, so on a cold `networkidle`
       * the reveal states have not been created yet — the walk below scrolled
       * past every section while they were all still visible, GSAP then landed
       * and set the below-fold ones to `opacity: 0`, and the probe measured a
       * heading that was mid-fade: 0 pixels within tolerance of its declared
       * ink, reported as "no glyphs". One second here, once per route, and
       * every `once` trigger has fired for real by the time anything is
       * measured. Only the motion context needs it; reduced motion has no
       * hidden state to clear, and paying it there would cost twelve seconds
       * across the run for nothing.
       */
      if (measuringMotion) await page.waitForTimeout(1000);
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.8;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 150));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
      });
      await page.waitForTimeout(700);
      /*
       * **Pause the film before measuring anything, and this is the probe's
       * own correctness rather than politeness.**
       *
       * `inkRatio` finds the pixels a glyph owns by differencing two
       * screenshots. Over a *playing* video every pixel differs between the
       * two grabs, so the whole bounding box passes the delta test and the
       * "ground under the glyphs" becomes the mean of the moving film.
       * Measured on the Film First hero: the lime marker reported 3.22:1
       * against a ground of #5E6A3E — half lime, half footage — for a pair
       * that is 13.54:1, and it counted 22,038 covered pixels for a two-word
       * mark. One frame held still, and the number is about the type again.
       * `filmFrames` then walks the film deliberately.
       */
      await page
        .evaluate(() => {
          for (const v of document.querySelectorAll('video')) v.pause();
        })
        .catch(() => {});
      await page.waitForTimeout(150);
      console.log(`\n=== ${route}  ${theme}  ${w}x${h} ===`);
      for (const [label, sel, i = 0] of TEXT[route]) {
        try {
          const r = await inkRatio(page, sel, i);
          if (r === null) console.log(`  TEXT  ${label.padEnd(22)}  (not found / no glyphs)`);
          else
            console.log(
              `  TEXT  ${label.padEnd(22)}  ${r.ratio.toFixed(2)}:1   ink ${r.ink} on ${r.ground}  (${r.covered}px)`,
            );
        } catch (e) {
          console.log(`  TEXT  ${label.padEnd(22)}  ERR ${String(e).slice(0, 70)}`);
        }
      }
      /* The film walk is theme-independent — `.on-film` pins the roles at the
         stage ramp — so it runs at the two widths that matter rather than in
         all six passes, where it would cost six minutes for one answer. */
      if (route === '/discover' && theme === 'light' && (w === 1440 || w === 390)) {
        try {
          await filmFrames(page);
        } catch (e) {
          console.log(`  FILM  ERR ${String(e).slice(0, 90)}`);
        }
      }
      if (route === '/discover' && measuringMotion) {
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(300);
          await cursorFrames(page);
        } catch (e) {
          console.log(`  LENS  ERR ${String(e).slice(0, 90)}`);
        }
      }
      for (const [label, sel, i = 0] of CONTROLS[route]) {
        try {
          const r = await boundaryRatio(page, sel, i);
          if (r === null) console.log(`  CTRL  ${label.padEnd(22)}  (not found)`);
          else
            console.log(
              `  CTRL  ${label.padEnd(22)}  ${r.ratio.toFixed(2)}:1   worst ground ${r.ground} vs ${r.control}`,
            );
        } catch (e) {
          console.log(`  CTRL  ${label.padEnd(22)}  ERR ${String(e).slice(0, 70)}`);
        }
      }
    }
    await ctx.close();
  }
}

await browser.close();
