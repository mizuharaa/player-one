/**
 * Before/after proof for the console demo-data fixes (untracked verification tool).
 *
 *   PHASE=before node apps/console/scripts/console-fix-shots.mjs
 *
 * Drives the real console over the real API with the stakeholder seed, as the
 * three seeded roles, and writes one PNG per finding into C:/build/console-fix.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.CONSOLE_URL ?? 'http://localhost:5173';
const OUT = 'C:/build/console-fix';
const PHASE = process.env.PHASE ?? 'before';
mkdirSync(OUT, { recursive: true });

const OPERATOR = {
  role: 'operator',
  machine_identifier: 'demo-machine-1',
  machine_secret: 'pw',
  external_ref: 'op-1',
  operator_secret: 'pw',
};
const FINANCE = { ...OPERATOR, external_ref: 'fin-1' };
const REVIEWER = { role: 'reviewer', external_ref: 'rev-1', operator_secret: 'pw' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(browser, credentials) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  const res = await context.request.post(`${BASE}/api/session`, { data: credentials });
  if (!res.ok()) {
    throw new Error(`sign-in failed for ${credentials.external_ref}: ${res.status()} ${await res.text()}`);
  }
  const page = await context.newPage();
  return { context, page };
}

async function shot(page, path, name, { wait = 2500 } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${PHASE}-${name}.png`, fullPage: true });
  process.stdout.write(`  ${PHASE}-${name}.png\n`);
}

const browser = await chromium.launch({ args: ['--disable-gpu', '--mute-audio'] });
try {
  process.stdout.write('operator (op-1)\n');
  {
    const { context, page } = await session(browser, OPERATOR);
    await shot(page, '/', 'operator-home');
    await shot(page, '/episodes', 'operator-episodes');
    await shot(page, '/settle', 'operator-settle');
    await context.close();
  }

  process.stdout.write('finance (fin-1)\n');
  {
    const { context, page } = await session(browser, FINANCE);
    await shot(page, '/settle', 'finance-settle-bills');
    await shot(page, '/settle/preflight', 'finance-preflight', { wait: 6000 });
    await shot(page, '/backoffice', 'finance-backoffice');
    await context.close();
  }

  process.stdout.write('reviewer (rev-1)\n');
  {
    const { context, page } = await session(browser, REVIEWER);
    await shot(page, '/review', 'reviewer-review', { wait: 4000 });
    await shot(page, '/counter', 'reviewer-counter');
    await context.close();
  }
} finally {
  await browser.close();
}
