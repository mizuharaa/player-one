/**
 * The wordmark, as a raster the phone can draw.
 *
 * SPEC.md §20.3: `react-native-svg` is not a dependency and is not being added
 * for one static shape (§20.1), so the wordmark ships as a PNG. The source is
 * the console's **monochrome** variant — one colour, `currentColor` — because
 * every surface it lands on tints it differently: `discover.ink` on the
 * splash's paper, `discover.surface` over the Welcome film, and again over the
 * sign-in hero. `<Image tintColor>` repaints an opaque mask; it cannot recolour
 * the six-colour brand variant, so that one is not the source here.
 *
 * One file, not a 1x/@2x/@3x set. The widest the mark is ever drawn is 62 % of
 * a 412 dp artboard on the splash — 255 dp, so 765 px on a 3x screen — and one
 * 1568 px asset is above that everywhere while staying a 20 KB download.
 * Metro's density suffixes would buy nothing but three files to keep in sync.
 *
 * Playwright is already a devDependency (it drives `web/shots.mjs`), so this
 * needs no new tool. Re-run it when the wordmark geometry changes, the same
 * condition the console's own `export-master.mjs` carries:
 *
 *   node apps/collector/scripts/render-wordmark.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../console/src/components/logo-animation/playerone-wordmark-monochrome.svg');
const target = resolve(here, '../assets/discover/playerone-wordmark.png');

/** The artboard, times two. `viewBox` is `0 0 784 152` and that ratio is load-bearing. */
const WIDTH = 1568;
const HEIGHT = 304;

const svg = readFileSync(source, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><style>html,body{margin:0;background:transparent}
   svg{display:block;width:${WIDTH}px;height:${HEIGHT}px;color:#000}</style>${svg}`,
);
writeFileSync(target, await page.screenshot({ omitBackground: true }));
await browser.close();
console.log(`${target} ${WIDTH}x${HEIGHT}`);
