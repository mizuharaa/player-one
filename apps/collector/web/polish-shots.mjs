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
    if (section === 'section-4') {
      for (const state of ['empty', 'error', 'offline']) for (const screen of ['home', 'taskHall', 'uploads', 'income', 'myTasks', 'devices', 'notifications', 'sessionCreate', ...(state === 'empty' ? [] : ['taskDetail', 'profile'])]) {
        await page.goto(`http://127.0.0.1:5177/?screen=${screen}&ready=1&lang=vi&state=${state}`);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${out}/${width}-${screen}-${state}.png`, fullPage: true }); count++;
      }
      for (const screen of ['forum', 'groupChats', 'groupThread', 'training', 'provisioning']) {
        await page.goto(`http://127.0.0.1:5177/?screen=${screen}&ready=1&lang=vi`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/${width}-${screen}-placeholder.png`, fullPage: true }); count++;
      }
      await page.goto('http://127.0.0.1:5177/?screen=notifications&ready=1&lang=en');
      await page.getByRole('button', { name: 'Notification settings', exact: true }).click();
      await page.screenshot({ path: `${out}/${width}-notification-settings-placeholder.png`, fullPage: true }); count++;
      await page.goto('http://127.0.0.1:5177/?screen=signin&lang=vi&state=offline');
      await page.getByLabel('S\u1ed1 \u0111i\u1ec7n tho\u1ea1i', { exact: true }).fill('903000001');
      await page.getByRole('button', { name: 'G\u1eedi m\u00e3', exact: true }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${width}-signin-offline.png`, fullPage: true }); count++;
      await page.getByRole('button', { name: 'M\u00e1y ch\u1ee7', exact: true }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${width}-signin-server.png`, fullPage: true }); count++;
    }
    if (section === 'section-6' || section === 'section-7') {
      await page.goto('http://127.0.0.1:5177/?screen=home&ready=1&lang=vi');
      await page.waitForTimeout(500);
      await page.evaluate(() => { const scroller = [...document.querySelectorAll('div')].find(node => getComputedStyle(node).overflowY === 'auto' && node.scrollHeight > node.clientHeight); if (!scroller) throw new Error('Home scroller missing'); scroller.scrollTop = 620; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${width}-home-carousel.png` }); count++;
      await page.goto('http://127.0.0.1:5177/?screen=about&lang=en');
      await page.getByRole('button', { name: 'Photo credits', exact: true }).click();
      await page.screenshot({ path: `${out}/${width}-photo-credits.png`, fullPage: true }); count++;
    }
    await page.close();
    for (const [beat, time] of [['ring',600], ['one',1500], ['plate',2200], ['wipe',2900]]) {
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
