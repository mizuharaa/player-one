/**
 * Drive Engineering → Debug delivery end to end, headless, and fail loudly.
 *
 *   CONSOLE_URL=http://localhost:5173 \
 *   PLAYERONE_DEMO_PHONE=+84900000001 \
 *   SESSION_DIR="…/ego_AZER76400FE_20260813_072310" \
 *   OUT=C:/build/dbg-shots \
 *     node apps/console/scripts/debug-delivery-drive.mjs
 *
 * Not a test — it needs a running API, a running object store, a seeded
 * database and a real session directory on disk, which is exactly the set of
 * things a unit test must not need. It is the proof that the page works
 * against the real routes, and it is committed so the next person can run it
 * before a demonstration instead of clicking through by hand.
 *
 * It asserts rather than screenshots. Every check below has a name, and one of
 * them failing exits non-zero with what the page actually said — a run that
 * produced a PNG of a sign-in page and printed nothing is the failure mode
 * `shots.mjs` already learnt about the hard way.
 */
import { chromium } from 'playwright';
import { acquireLock, guard } from './browser.mjs';
import { mkdir } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env['CONSOLE_URL'] ?? 'http://localhost:5173';
const PHONE = process.env['PLAYERONE_DEMO_PHONE'] ?? '+84900000001';
const SESSION_DIR = process.env['SESSION_DIR'];
const OUT = process.env['OUT'] ?? 'C:/build/dbg-shots';
/** The whole delivery: hash in JS, PUT, read-back, ffprobe, ingest. */
const DELIVERY_TIMEOUT_MS = Number(process.env['DELIVERY_TIMEOUT_MS'] ?? 300_000);

if (SESSION_DIR === undefined) {
  console.error('SESSION_DIR must name a session directory, e.g. …/ego_AZER76400FE_20260813_072310');
  process.exit(2);
}
const inventory = readdirSync(SESSION_DIR).map((f) => ({ f, bytes: statSync(join(SESSION_DIR, f)).size }));
const totalBytes = inventory.reduce((sum, e) => sum + e.bytes, 0);

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || detail === '' ? '' : `\n       ${detail}`}`);
  if (!ok) failures += 1;
};

await mkdir(OUT, { recursive: true });
const releaseLock = await acquireLock();
const browser = await chromium.launch();
guard(browser, releaseLock);

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
/** The browser's own console, so a CORS refusal is in this script's output. */
page.on('console', (message) => {
  if (message.type() === 'error') console.log(`       [browser] ${message.text().slice(0, 300)}`);
});

// -- 1. the operator, both credentials, and a refusal that is not swallowed ---

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="machine_identifier"]', 'HCM-01');
await page.fill('input[name="machine_secret"]', 'pw');
await page.fill('input[name="external_ref"]', 'op-1');
await page.fill('input[name="operator_secret"]', 'pw');
const [session] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/session') && r.request().method() === 'POST', {
    timeout: 20_000,
  }),
  page.click('button[type="submit"]'),
]);
check(session.ok(), 'the operator signs in', `${session.status()} ${(await session.text()).slice(0, 200)}`);
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 });

// -- 2. the flag is what puts the page on the Engineering screen -------------

await page.goto(`${BASE}/engineering`, { waitUntil: 'domcontentloaded' });
const link = page.getByRole('link', { name: /debug delivery/i });
await link.waitFor({ timeout: 20_000 });
check(true, 'Engineering offers the page, because the server reports the flag');
await Promise.all([page.waitForURL(/debug-delivery/, { timeout: 20_000 }), link.click()]);

// -- 3. the collector's own sign-in, and the demo echo -----------------------

await page.fill('#dbg-phone', PHONE);
/**
 * One code per number per minute, and the route says so with a 429 and a
 * `retry-after`. That is SEC-03's send cooldown and not a fault: it exists so
 * this service cannot be used to send messages at somebody's phone. A script
 * run twice inside a minute meets it, so it waits the header out rather than
 * reporting a failure an operator would also have hit and shrugged at.
 */
let codeAnswer;
for (let attempt = 1; ; attempt += 1) {
  [codeAnswer] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/collector/request-code'), { timeout: 20_000 }),
    page.getByRole('button', { name: /send the code/i }).click(),
  ]);
  if (codeAnswer.status() !== 429 || attempt > 2) break;
  const wait = Number(codeAnswer.headers()['retry-after'] ?? 60) + 2;
  console.log(`     request-code is on cooldown (429, retry-after ${wait - 2}s); waiting`);
  await page.waitForTimeout(wait * 1000);
}
check(
  codeAnswer.status() === 200,
  `request-code answers 200 for ${PHONE} (the demo number), not 204`,
  `status ${codeAnswer.status()}`,
);
await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#dbg-code')?.value ?? ''), {
  timeout: 20_000,
});
const filled = await page.inputValue('#dbg-code');
check(/^\d{6}$/.test(filled), 'the page filled the code in from the server answer');

const [verified] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/auth/collector/verify'), { timeout: 20_000 }),
  page.getByRole('button', { name: /verify and hold the token/i }).click(),
]);
check(verified.ok(), 'the collector token comes from /auth/collector/verify', String(verified.status()));
await page.getByTestId('dbg-signed-in').waitFor({ timeout: 20_000 });

/**
 * And it is nowhere a script can find it later. The token lives in a `useRef`
 * for the life of the tab; anything in `localStorage` or a cookie would
 * outlive it.
 */
const leaked = await page.evaluate(() => ({
  storage: JSON.stringify(Object.entries(localStorage)),
  cookie: document.cookie,
}));
check(
  !leaked.storage.includes(filled) && !/collector/i.test(leaked.cookie),
  'the collector credential is not in localStorage or a cookie',
  JSON.stringify(leaked).slice(0, 300),
);

// -- 4. the collection session the delivery is attributed to (APP-16) --------

const sessionButtons = page.locator('.dbg-choices button');
if ((await sessionButtons.count()) === 0) {
  const [declared] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/me/sessions') && r.request().method() === 'POST', {
      timeout: 20_000,
    }),
    page.getByRole('button', { name: /declare a new session/i }).click(),
  ]);
  check(declared.ok(), 'a collection session is declared through POST /api/me/sessions', String(declared.status()));
}
await sessionButtons.first().waitFor({ timeout: 20_000 });
await sessionButtons.first().click();
/**
 * Waited for, not read once. `aria-pressed` is React state and the attribute
 * appears on the commit after the click, so reading it in the same turn is a
 * race — it failed that way on the first run of this script while the page was
 * behaving correctly.
 */
await page.locator('.dbg-choices button[aria-pressed="true"]').first().waitFor({ timeout: 20_000 });
check(true, 'the session is chosen, and says so to a screen reader as well as by colour');

// -- 5. the folder, refused before hashing when it is the wrong one ----------

/**
 * The parent of the session, which is what somebody picks when they mean to
 * pick the session. `looksLikeSessionDirectory` — the SAME function the phone
 * uses and the server's own naming rule — has to refuse it here, before any
 * hashing, and by name.
 */
await page.setInputFiles('#dbg-directory', join(SESSION_DIR, '..'));
await page.getByTestId('dbg-pick-error').waitFor({ timeout: 20_000 });
const pickRefusal = await page.getByTestId('dbg-pick-error').innerText();
/**
 * Either refusal is right and which one fires depends on the folder. A corpus
 * root holds session DIRECTORIES, so the nested check catches it first and
 * says the more precise thing; a flat folder whose name is not a session name
 * reaches `looksLikeSessionDirectory` — the same function the phone uses — and
 * gets `session_basename_unrecognised`. What matters is that a wrong pick is
 * named before any hashing, not which of the two names it gets.
 */
check(
  /flat session directory|not a session directory name/i.test(pickRefusal),
  'picking the folder ABOVE the session is refused by name, before hashing',
  pickRefusal,
);

await page.setInputFiles('#dbg-directory', SESSION_DIR);
const shown = await page.locator('.engineering-facts').first().innerText();
check(
  shown.includes(String(inventory.length)),
  `the inventory reads ${inventory.length} files off the folder`,
  shown.replace(/\n/g, ' | '),
);
check(
  shown.replace(/[^\d]/g, '').includes(String(totalBytes)),
  `and ${totalBytes} bytes`,
  shown.replace(/\n/g, ' | '),
);

// -- 6. the delivery -------------------------------------------------------

const started = Date.now();
await page.getByTestId('dbg-start').click();
/**
 * Race the verdict against the page's own error block. Waiting only for the
 * state word means a delivery that threw — a 404 from a bucket that does not
 * exist, a CORS refusal — burns the whole timeout and then reports nothing
 * useful. Measured: the first run of this script sat for 300 s on a missing
 * bucket while the page had been showing the reason the entire time.
 */
await Promise.race([
  page
    .getByTestId('dbg-state')
    .filter({ hasText: /^(ingested|held|failed)$/ })
    .waitFor({ timeout: DELIVERY_TIMEOUT_MS }),
  page.getByTestId('dbg-error').waitFor({ timeout: DELIVERY_TIMEOUT_MS }),
]);
if ((await page.getByTestId('dbg-error').count()) > 0) {
  check(false, 'the delivery ran without the page refusing it', await page.getByTestId('dbg-error').innerText());
  await page.screenshot({ path: join(OUT, 'debug-delivery-refused.png'), fullPage: true });
  await browser.close();
  process.exit(1);
}
const state = (await page.getByTestId('dbg-state').innerText()).trim();
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const reason = (await page.getByTestId('dbg-reason').count()) > 0
  ? await page.getByTestId('dbg-reason').first().innerText()
  : '';
check(state === 'ingested', `the server's state word is "ingested" after ${seconds}s`, `${state} — ${reason}`);

const episodeId = (await page.getByTestId('dbg-episode').count()) > 0
  ? (await page.getByTestId('dbg-episode').innerText()).trim()
  : null;
check(episodeId !== null, 'and it names the episode it made');
const uploadId = (await page.getByTestId('dbg-upload-id').innerText()).trim();

await page.screenshot({ path: join(OUT, 'debug-delivery-ingested.png'), fullPage: true });

// -- 7. the links out ------------------------------------------------------

const episodeLink = page.getByRole('link', { name: /open this episode/i });
await episodeLink.waitFor({ timeout: 20_000 });
await Promise.all([page.waitForURL(/engineering\?episode=/, { timeout: 20_000 }), episodeLink.click()]);
const inspector = page.locator('.engineering-inspector');
await inspector.waitFor({ timeout: 20_000 });
await page.waitForFunction(
  (id) => document.querySelector('.engineering-inspector')?.textContent?.includes(id) ?? false,
  episodeId,
  { timeout: 30_000 },
);
check(true, 'the episode link opens the inspector on that episode');
await page.screenshot({ path: join(OUT, 'debug-delivery-episode.png'), fullPage: true });

await page.goto(`${BASE}/engineering/debug-delivery`, { waitUntil: 'domcontentloaded' });
check(
  (await page.evaluate(() => localStorage.getItem('playerone.console.debugDelivery'))) === null,
  'the resume record is cleared on ingested, so the page does not offer to resume a finished delivery',
);

console.log('');
console.log(`upload id  ${uploadId}`);
console.log(`episode    ${episodeId}`);
console.log(`session    ${SESSION_DIR}`);
console.log(`shots      ${OUT}`);

await context.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
