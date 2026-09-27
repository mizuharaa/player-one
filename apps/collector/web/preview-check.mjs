import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run with Vite listening on 5177: node apps/collector/web/preview-check.mjs
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.BASE_URL ?? 'http://127.0.0.1:5177';
  await page.goto(`${base}/preview.html`);
  const phone = page.locator('#phone');
  const app = page.frameLocator('#phone');
  await app.locator('#root > *').waitFor();
  await app.getByText('Nhiệm vụ của tôi', { exact: true }).waitFor();
  assert.equal(await phone.getAttribute('width'), '360');
  assert.equal(new URL(await phone.getAttribute('src')).origin, new URL(base).origin);
  await page.getByLabel('Viewport').selectOption('320x640');
  assert.equal(await phone.getAttribute('width'), '320');
  assert.equal(await phone.getAttribute('height'), '640');
  await page.getByLabel('Screen', { exact: true }).selectOption('uploads');
  await page.getByLabel('Language').selectOption('en');
  await app.getByText('From recording to review', { exact: true }).waitFor();
  await page.getByLabel('Data state').selectOption('offline');
  assert.equal(new URL(await phone.getAttribute('src')).searchParams.get('state'), 'offline');
  await app.getByText('Cannot connect to the server', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS mobile preview: rendered app, viewport, screen, language and state controls');
} finally { await browser.close(); }
