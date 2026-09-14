// @ts-check
/**
 * Every artboard of the v2 mock, as a PNG, at the three phone widths that
 * matter.
 *
 * The mock is the thing the owner approves before any React Native is
 * written, so the pictures have to be taken rather than described. This
 * follows the same shape as `apps/collector/web/shots.mjs`: a real browser,
 * a real viewport, and a failure if the page logged an error.
 *
 *   node docs/design/mobile-v2/mock/shots.mjs
 *
 * What it honestly shows: layout, type, colour, overflow, the Vietnamese
 * copy, and whether anything reflows badly at 360 or 412. What it cannot
 * show, and must not be quoted for: Android elevation, real status-bar and
 * gesture insets, the system typeface, or on-device animation timing.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
const PAGE = '/docs/design/mobile-v2/mock/index.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.js': 'text/javascript',
};

/**
 * A static server rather than `file://`, because a `file://` page cannot
 * autoplay a video and the poster would be all these shots ever showed.
 */
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^[\\/]+/, '');
  const path = join(ROOT, rel);
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** id → filename, in the order the owner reads them. */
const BOARDS = [
  ['b01', '01-splash'], ['b02', '02-welcome'], ['b03', '03-signin'],
  ['b03b', '03b-signin-cn'], ['b04', '04-verify'], ['b05', '05-register'],
  ['b06', '06-agreements'], ['b07', '07-training'], ['b08', '08-exam'],
  ['b09', '09-coach-marks'], ['b10', '10-home'], ['b11', '11-task-hall'],
  ['b12', '12-task-detail'], ['b13', '13-uploads'], ['b14', '14-income'],
  ['b15', '15-devices'], ['b16', '16-profile'], ['b17', '17-states'],
  ['b18', '18-home-no-cycle'], ['b19', '19-splash-reduced'],
];

/** The screens the owner will actually resize in front of you. */
const RESPONSIVE = [['b02', '02-welcome'], ['b10', '10-home']];
const SIZES = [[360, 780], [412, 915]];
/**
 * 320x640 in Vietnamese is where a tab label decides whether it fits, and it
 * is the case this lane has already been caught by once: 'Trang chinh' wrapped
 * to two lines at 360 and made one tab taller than its four siblings. Every
 * screen that carries the bar gets a picture here.
 */
const NARROW = [['b10', '10-home'], ['b11', '11-task-hall'],
                ['b13', '13-uploads'], ['b14', '14-income']];

const problems = [];
const shots = [];

/* Empty the directory rather than removing it. On Windows a shell or an
   indexer sitting in `shots/` makes rmdir fail with EBUSY, and the run dies
   before it has taken a single picture. */
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.png')) await unlink(OUT + f);

const browser = await chromium.launch();

async function open(w, h, only, reduced = false) {
  const page = await browser.newPage({
    viewport: { width: w + 80, height: h + 120 },
    deviceScaleFactor: 2,
    ...(reduced ? { reducedMotion: 'reduce' } : {}),
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(`${BASE}${PAGE}?only=${only}&w=${w}&h=${h}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Long enough for the 1500 ms assembly to have locked, so the splash is
  // photographed finished rather than mid-scramble.
  await page.waitForTimeout(1900);
  return page;
}

async function shot(page, id, name) {
  const el = page.locator(`#${id}`);
  await el.screenshot({ path: `${OUT}${name}.png` });
  shots.push(`${name}.png`);
  console.log(`  ${name}.png`);
}

console.log('390x844');
for (const [id, name] of BOARDS) {
  const page = await open(390, 844, id, id === 'b19');
  await shot(page, id, name);
  await page.close();
}

for (const [w, h] of SIZES) {
  console.log(`${w}x${h}`);
  for (const [id, name] of RESPONSIVE) {
    const page = await open(w, h, id);
    await shot(page, id, `${name}-${w}x${h}`);
    await page.close();
  }
}

console.log('320x640 (vi, the case that fails first)');
for (const [id, name] of NARROW) {
  const page = await open(320, 640, id);
  await shot(page, id, `${name}-320x640`);
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${shots.length} shots in docs/design/mobile-v2/mock/shots/`);
if (problems.length > 0) {
  console.error(`\n${new Set(problems).size} distinct console/page errors:`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exitCode = 1;
}
