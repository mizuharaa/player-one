// Browser fixture evidence only; native transfer and actual device behavior need an iPhone check.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const out = process.env.PLAYERONE_SHOTS_DIR ?? 'C:/build/mobile-v3-polish-shots/upload-progress';
const base = process.env.PLAYERONE_HARNESS_URL ?? 'http://127.0.0.1:5177';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 932 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const shot = async name => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
      await page.screenshot({ path: `${out}/${width}-${name}.png`, fullPage: true });
    };
    const tap = name => page.getByRole('button', { name, exact: true }).click();
    await page.goto(`${base}/?screen=uploads&ready=1&lang=en`);
    await page.getByText('From recording to review', { exact: true }).waitFor();
    await shot('sessions');
    await page.goto(`${base}/?screen=uploads&lang=en&state=upload-stalled`);
    await tap('Upload a recorded session'); await tap('Send from this phone'); await tap('Next');
    await tap('Choose session folder');
    await page.getByText('Your only collection session is selected. Check it before sending.', { exact: true }).waitFor();
    await shot('session-selection');
    await tap('Next'); await tap('Start upload');
    await page.getByText('25%', { exact: true }).waitFor();
    await shot('sending-25');
    await page.clock.install(); await page.clock.fastForward(16_000);
    await page.getByText(/No new progress yet/).waitFor();
    await shot('sending-stalled');
    await tap('Cancel');
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await shot('cancelled');
    await tap('Try again');
    await page.getByText('25%', { exact: true }).waitFor();
    await shot('resumed-25');
    await page.clock.fastForward(61_000);
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await shot('timed-out');
    await page.clock.resume();
    for (const result of ['verifying', 'held', 'ingested']) {
      await page.goto(`${base}/?screen=uploads&lang=en&state=upload-stalled&uploadResult=${result}`);
      await tap('Upload a recorded session'); await tap('Send from this phone'); await tap('Next');
      await tap('Choose session folder');
      await page.getByText('Your only collection session is selected. Check it before sending.', { exact: true }).waitFor();
      await tap('Next'); await tap('Start upload');
      if (result === 'verifying') {
        await page.getByText('Verifying cloud copy', { exact: true }).waitFor();
        assert.equal(await page.getByText('100%', { exact: true }).count(), 0);
      } else await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
      await shot(result);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`PASS 20 upload browser fixture captures: ${out}`);
} finally { await browser.close(); }
