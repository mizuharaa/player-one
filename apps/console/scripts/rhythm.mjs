/**
 * The spacing audit: what makes a screen read as generated.
 *
 * Daniel's words, and they name the tell precisely: *"the uneven and
 * inconsistent spacing between text and images and sometimes hide it, makes it
 * uncanny."* That is not a taste complaint. It is three measurable faults, and
 * a person notices all three before they can say why:
 *
 * 1. **Clipping.** An element whose own content overflows its box, so a word or
 *    a figure is cut. Never intentional on these screens.
 * 2. **Covering.** An element drawn over another so the one underneath cannot be
 *    hit at its own centre. A pinned bar over a field is the version this
 *    project has already shipped twice.
 * 3. **An off-scale gap.** A vertical gap between siblings that is not on the
 *    4px grid the tokens are built from. Two gaps of 13px and 19px where the
 *    system says 12 and 20 is exactly the wrongness nobody can name.
 *
 * It reports, it does not fix: a script that rewrites spacing would be guessing
 * at intent. What it gives is a list short enough to act on, with the element
 * named, so the fix is a decision somebody makes.
 *
 * Run against the dev server, no database:
 *   CONSOLE_URL=http://localhost:5190 node scripts/rhythm.mjs
 *   COLLECTOR_URL=http://localhost:5178 node scripts/rhythm.mjs
 */
import { chromium } from 'playwright';

const CONSOLE_URL = process.env.CONSOLE_URL ?? 'http://localhost:5190';
const COLLECTOR_URL = process.env.COLLECTOR_URL ?? '';

/**
 * The spacing scale, read off `packages/design/src/tokens.ts` rather than
 * assumed.
 *
 * Written first as "any multiple of 4", which flagged every `mt-1.5` on the
 * episodes screen — and 6px is `space[1.5]`, a real step the system owns. A
 * check that fails on values the design system defines is a check nobody will
 * keep running, so this is the explicit set. `space` is the authority; if a
 * step is added there it belongs here too.
 */
const SCALE = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80];
/** Below this a gap is a hairline or a rounding artefact, not a rhythm choice. */
const FLOOR = 6;
/** One pixel of tolerance: sub-pixel layout rounds, and 19.6 is a 20. */
const TOLERANCE = 1;

/*
 * The audit runs *in the page*, so the two constants above cannot be closed
 * over — they are interpolated into the source. Written without that first,
 * and it threw `FLOOR is not defined` on the first run.
 */
const AUDIT = `(() => {
  const SCALE = ${JSON.stringify(SCALE)}, FLOOR = ${FLOOR}, TOL = ${TOLERANCE};
  const onScale = (g) => SCALE.some((v) => Math.abs(g - v) <= TOL);
  const out = { clipped: [], covered: [], offGrid: [] };
  const name = (el) => {
    const t = el.tagName.toLowerCase();
    const cls = (el.className && String(el.className).split(' ')[0]) || '';
    const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26);
    return t + (cls ? '.' + cls : '') + (txt ? ' “' + txt + '”' : '');
  };
  const vis = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  };

  const all = [...document.querySelectorAll('body *')].filter(vis);

  /* 1. Clipping: content wider or taller than the box that holds it. */
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto') continue;
    /*
     * \`sr-only\` is a 1px box on purpose — the text is for a screen reader and
     * clipping it is the technique, not a fault. Reported three times on every
     * console screen on the first run, which is how a check earns a mute.
     */
    if (el.classList.contains('sr-only')) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      out.clipped.push({ el: name(el), by: el.scrollWidth - el.clientWidth, axis: 'x' });
    else if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && s.overflow === 'hidden')
      out.clipped.push({ el: name(el), by: el.scrollHeight - el.clientHeight, axis: 'y' });
  }

  /* 2. Covering: a control whose own centre belongs to something else. */
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"]')) {
    if (!vis(el)) continue;
    /*
     * The clipping check already mutes \`sr-only\`; this one did not, and the
     * asymmetry produced a finding nobody could act on. A skip link is
     * \`clip: rect(0,0,0,0)\` at rest and reveals on focus, so of course
     * something else owns the pixel at its centre — that is the technique,
     * not a control being covered.
     */
    if (el.classList.contains('sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
      out.covered.push({ el: name(el), by: name(hit) });
  }

  /* 3. Off-grid vertical gaps between visible siblings in a stack. */
  const seen = new Set();
  for (const parent of all) {
    const kids = [...parent.children].filter(vis).filter((k) => {
      const r = k.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) return false;
      /*
       * An out-of-flow child is not in a stack, so the distance to its
       * neighbour is not a rhythm decision and there is nothing to round to
       * the scale. Measuring them anyway produced a finding nobody could
       * fix: a 22px gap on the collector's sign-in that turned out to be two
       * absolutely positioned shapes *inside an 80dp drawing*, moving apart
       * because the mascot's arm was mid-wave.
       *
       * Worse, that finding was intermittent and the audit hid it: sampled
       * every 120ms it appeared in 24 of 60 frames with motion on and 0 of
       * 60 under \`reduce\`, while this script's own fixed timing happened to
       * land on a clean phase five runs out of five. A check that reports
       * clean by luck is worse than one that reports nothing.
       */
      const pos = getComputedStyle(k).position;
      return pos !== 'absolute' && pos !== 'fixed';
    });
    if (kids.length < 2) continue;
    for (let i = 1; i < kids.length; i += 1) {
      const a = kids[i - 1].getBoundingClientRect();
      const b = kids[i].getBoundingClientRect();
      /* Only a genuine vertical stack: the boxes must not sit side by side. */
      if (b.top < a.bottom - 1) continue;
      if (b.left > a.right - 1 || a.left > b.right - 1) continue;
      const gap = Math.round(b.top - a.bottom);
      if (gap < FLOOR || onScale(gap)) continue;
      const key = name(kids[i - 1]) + '|' + name(kids[i]) + '|' + gap;
      if (seen.has(key)) continue;
      seen.add(key);
      out.offGrid.push({ gap, after: name(kids[i - 1]), before: name(kids[i]) });
    }
  }
  return out;
})()`;

/*
 * Read the whole page before measuring it.
 *
 * The audit only ever saw the first viewport, because that is all that had
 * been painted — everything below the fold was measured in whatever state it
 * happened to be in, and anything that reveals on scroll was invisible, which
 * `vis()` drops. A dropped element is not a clean element: with a section
 * skipped, the gap reported is the distance between its *neighbours*, and Home
 * duly reported a 318px gap that no element on the page has. So scroll to the
 * bottom and back, one viewport at a time, and let every observer fire before
 * anything is measured.
 */
async function readWholePage(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 600));
  });
}

async function audit(page, url, label, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1600);
  await readWholePage(page);
  const r = await page.evaluate(AUDIT);
  const total = r.clipped.length + r.covered.length + r.offGrid.length;
  console.log(`\n${label}  ${width}×${height}  —  ${total === 0 ? 'clean' : total + ' findings'}`);
  for (const c of r.clipped.slice(0, 6)) console.log(`   CLIPPED  ${c.by}px on ${c.axis}  ${c.el}`);
  for (const c of r.covered.slice(0, 6)) console.log(`   COVERED  ${c.el}  ←  ${c.by}`);
  for (const g of r.offGrid.slice(0, 8)) console.log(`   GAP ${String(g.gap).padStart(3)}px  ${g.after}  →  ${g.before}`);
  return total;
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
let findings = 0;

if (!COLLECTOR_URL) {
  await page.goto(`${CONSOLE_URL}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.fill('input[name="machine_identifier"]', 'HCM-01');
  await page.fill('input[name="machine_secret"]', 'pw');
  await page.fill('input[name="external_ref"]', process.env.OPERATOR ?? 'op-1');
  await page.fill('input[name="operator_secret"]', 'pw');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/session') && r.request().method() === 'POST'),
    page.click('button[type=submit]'),
  ]);
  await page.waitForTimeout(1500);

  for (const route of (process.env.ROUTES ?? '/,/review,/episodes,/backoffice,/counter,/pipeline').split(',')) {
    for (const [w, h] of [[1440, 900], [1280, 720]]) {
      findings += await audit(page, CONSOLE_URL + route, `console ${route}`, w, h);
    }
  }
} else {
  for (const q of ['/', '/?screen=landing', '/?screen=signin']) {
    for (const [w, h] of [[390, 844], [320, 640]]) {
      findings += await audit(page, COLLECTOR_URL + q, `collector ${q}`, w, h);
    }
  }
}

await browser.close();
console.log(`\n${findings === 0 ? 'RHYTHM CLEAN' : findings + ' TOTAL FINDINGS'}`);
