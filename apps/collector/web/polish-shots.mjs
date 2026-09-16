import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const section = process.argv[2] ?? 'section-1';
const out = `C:/build/mobile-v3-polish-shots/${section}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let count = 0;
try {
  for (const width of [390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 932 }, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const screen of ['home', 'taskHall', 'taskDetail', 'uploads', 'income']) {
      await page.goto(`http://127.0.0.1:5177/?screen=${screen}&ready=1&lang=vi`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${width}-${screen}.png`, fullPage: true }); count++;
    }
    if (section !== 'section-1' && section !== 'section-2') for (const screen of ['home', 'taskHall', 'taskDetail', 'uploads', 'income']) {
      await page.goto(`http://127.0.0.1:5177/?screen=${screen}&ready=1&lang=vi&state=loading`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/${width}-${screen}-loading.png`, fullPage: true }); count++;
    }
    await page.close();
    for (const [beat, time] of [['ring',600], ['one',1300], ['plate',1700], ['wipe',2250]]) {
      const intro = await browser.newPage({ viewport: { width, height: 932 }, reducedMotion: 'no-preference' });
      intro.on('pageerror', error => errors.push(error.message));
      await intro.goto('http://127.0.0.1:5177/?screen=home&ready=1&intro=1&lang=vi');
      await intro.getByTestId('boot-intro').waitFor();
      await intro.waitForTimeout(time);
      await intro.screenshot({ path: `${out}/${width}-intro-${beat}.png` }); count++;
      await intro.close();
    }
    if (errors.length) throw new Error(errors.join('\n'));
  }
  console.log(`${count} screenshots saved: ${out}`);
} finally { await browser.close(); }
