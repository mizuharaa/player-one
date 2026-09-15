import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('artifacts/mobile-v3');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [320, 390, 430]) for (const scale of [1, 1.3]) {
    for (const screen of ['onboarding', 'landing', 'signin', 'home', 'sessionCreate', 'uploads', 'income', 'taskHall', 'taskDetail', 'profile', 'notifications', 'about', 'privacy', 'devices']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`http://localhost:5177/?screen=${screen}&ready=1&lang=vi`);
      await page.waitForFunction(() => document.body.innerText.trim().length > 20);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      // Browser approximation only; native Dynamic Type remains a device check.
      if (scale !== 1) await page.evaluate(scale => {
        for (const node of document.querySelectorAll('*')) {
          if (![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
          const style = getComputedStyle(node);
          node.style.fontSize = `${parseFloat(style.fontSize) * scale}px`;
          if (style.lineHeight !== 'normal') node.style.lineHeight = `${parseFloat(style.lineHeight) * scale}px`;
        }
      }, scale);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const name = `${screen}-${width}-${scale}`;
      await page.screenshot({ path: resolve(out, `${name}.png`) });
      results.push({ name, overflow, errors });
      await page.close();
    }
  }
} finally { await browser.close(); }
await writeFile(resolve(out, 'checks.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ captures: results.length, failures: results.filter(row => row.overflow || row.errors.length) }, null, 2));
if (results.some(row => row.overflow || row.errors.length)) process.exitCode = 1;
