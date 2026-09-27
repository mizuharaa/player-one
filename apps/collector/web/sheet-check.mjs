import assert from 'node:assert/strict';
import { withBrowser, newPage } from '../../console/scripts/browser.mjs';

// A real browser catches Modal portal animation bugs that the reduced-motion unit mock cannot.
// Run the fixture-only Vite preview first, then BASE_URL=http://127.0.0.1:5187 node web/sheet-check.mjs.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5177';
await withBrowser(async browser => {
  for (const [width, height, motion] of [[390, 844, true], [320, 640, false]]) {
    const { page, context } = await newPage(browser, { viewport: { width, height }, motion });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?screen=taskDetail&taskId=task-warehouse&lang=en&ready=1`, { waitUntil: 'networkidle' });
    const claim = page.getByRole('button', { name: 'Review task', exact: true });
    const sheet = page.getByTestId('preferences-sheet-surface');
    const confirm = page.getByRole('button', { name: 'Confirm task claim', exact: true });
    await claim.click();
    await page.waitForTimeout(650);
    assert.equal(await sheet.evaluate(node => getComputedStyle(node).opacity), '1', 'sheet must finish visibly');
    const box = await confirm.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= height, 'confirmation stays above safe-area bottom');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert(await claim.isVisible(), 'dismissal does not claim the task');
    await claim.click();
    await page.waitForTimeout(650);
    assert.equal(await sheet.evaluate(node => getComputedStyle(node).opacity), '1', 'reopened sheet must also animate');
    await confirm.click();
    await sheet.waitFor({ state: 'hidden' });
    const toast = page.getByTestId('collector-toast');
    await toast.waitFor();
    await page.waitForFunction(() => { const node = document.querySelector('[data-testid="collector-toast"]'); return node && getComputedStyle(node).opacity === '1'; }, null, { timeout: 1500 });
    assert.equal(await toast.evaluate(node => getComputedStyle(node).opacity), '1', 'claim acknowledgment must animate visibly');
    assert.equal(await claim.count(), 0, 'successful fixture claim opens recording preparation');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS claim sheet, safe areas, dismiss/reopen, confirmation and toast: ${width}x${height}, ${motion ? 'normal' : 'reduced'} motion`);
  }
});
