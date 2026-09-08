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

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5190';

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
  '/discover': [
    ['h1', 'h1'],
    ['marker on lime', 'mark.marker'],
    ['lead', 'section p', 0],
    ['fact label', 'dl dt', 0],
    ['fact body', 'dl dd', 0],
    ['section h2', 'h2', 0],
    ['video caption', 'figure figcaption', 0],
    ['step number', 'ol li span', 0],
    ['step body', 'ol li p', 0],
    ['cell body on card', 'div.items-start > div > p', 0],
    ['ink cell body', '.feature-block p'],
    ['question', 'dl dt', 3],
    ['answer', 'dl dd', 3],
    ['nav sign-in label', 'header a'],
  ],
};

const CONTROLS = {
  '/login': [
    ['text field', 'input[name=machine_identifier]'],
    ['segmented track', 'div[role=presentation]'],
    ['submit', 'button[type=submit]'],
  ],
  '/discover': [
    ['nav sign-in pill', 'header a'],
    ['primary CTA', 'section a[href="#how"]'],
    ['secondary CTA', 'section a[href="/login"]', 0],
  ],
};

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => localStorage.setItem('playerone.theme', t), theme);

    for (const route of ['/login', '/discover']) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
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
