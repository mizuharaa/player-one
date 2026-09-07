// @ts-check
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Every screen, at phone size, in both languages, into `.impeccable/review/`.
 *
 * A typecheck cannot see a ring drawn from the wrong angle, a tab label that
 * wraps in Vietnamese, a hero that covers the sign-in button, or a legend whose
 * counts do not add up. This can, and it is the proof a visual change is
 * expected to carry.
 *
 * It drives the **browser harness**, not a phone. What it shows honestly:
 * layout, type, colour, overflow, state, and copy in both catalogues. What it
 * cannot show, and must not be quoted for: Android elevation
 * (react-native-web drops it), the real status-bar and gesture-bar insets, the
 * system typeface, TalkBack order, and animation timing on real hardware.
 *
 *   pnpm -F @playerone/collector web       # in one terminal
 *   node apps/collector/web/shots.mjs      # in another
 *   SHOTS_URL=http://localhost:5177 node … # if the port moved
 */

const BASE = process.env.SHOTS_URL ?? 'http://localhost:5177';
const OUT = fileURLToPath(new URL('../.impeccable/review/', import.meta.url));

/** A phone, not a desktop window: 390×844 is the common Android class. */
const VIEWPORT = { width: 390, height: 844 };
/** The short end of the same range, where a hero has to give up height. */
const SHORT = { width: 390, height: 640 };
/**
 * The narrow end of it. 320dp is where the navigation bar's slot arithmetic
 * stops working and where Vietnamese — the longest of the three catalogues —
 * decides whether a label fits or ellipsises. Every new surface gets a picture
 * here, in Vietnamese, because that is the case that fails first.
 */
const NARROW = { width: 320, height: 640 };

/**
 * `react-native-web` logs this on every mount because `BackHandler` is an
 * Android API and there is no web equivalent. It is a platform difference the
 * harness has by definition, not a fault in the app, so it is the one message
 * this script does not count as a problem.
 */
const EXPECTED = /BackHandler is not supported on web/;

/** The strings these screens are actually made of, in both catalogues. */
const T = {
  vi: {
    signIn: 'Đăng nhập',
    sendCode: 'Gửi mã',
    language: 'English',
    back: 'Quay lại',
    close: 'Đóng',
    createAccount: 'Tạo tài khoản',
    acceptAll: 'Đồng ý cả sáu',
    trainingDone: 'Hoàn thành đào tạo',
    examSubmit: 'Nộp bài',
    hall: 'Sảnh nhiệm vụ',
    tasks: 'Nhiệm vụ',
    uploads: 'Tải lên',
    income: 'Thu nhập',
    guide: 'Xem hướng dẫn',
    perMinute: 'đ/phút hiệu quả',
    upload: 'Tải lên',
    forum: 'Diễn đàn',
    groups: 'Nhóm chat',
    filterAll: 'Tất cả',
    filterAnswered: 'Đã trả lời',
    compose: 'Viết bài mới',
  },
  en: {
    signIn: 'Sign in',
    sendCode: 'Send code',
    language: '中文',
    back: 'Back',
    close: 'Close',
    createAccount: 'Create account',
    acceptAll: 'Accept all six',
    trainingDone: 'Complete training',
    examSubmit: 'Submit',
    hall: 'Task hall',
    tasks: 'Tasks',
    uploads: 'Uploads',
    income: 'Income',
    guide: 'Show me',
    perMinute: 'VND/effective minute',
    upload: 'Upload',
    forum: 'Forum',
    groups: 'Group chats',
    filterAll: 'All',
    filterAnswered: 'Answered',
    compose: 'Write a post',
  },
  zh: {
    signIn: '登录',
    sendCode: '发送验证码',
    language: 'Tiếng Việt',
    back: '返回',
    close: '关闭',
    createAccount: '创建账号',
    acceptAll: '全部接受',
    trainingDone: '完成培训',
    examSubmit: '提交',
    hall: '任务大厅',
    tasks: '任务',
    uploads: '上传',
    income: '收入',
    guide: '看指引',
    perMinute: '越南盾/有效分钟',
    upload: '上传',
    forum: '论坛',
    groups: '群聊',
    filterAll: '全部',
    filterAnswered: '已回复',
    compose: '发新帖',
  },
};

/**
 * How many taps of the language chip reach this catalogue from Vietnamese.
 * The chip cycles vi → en → zh → vi and names the language it switches TO, so
 * the label to click is the one the CURRENT catalogue prints.
 */
const CHIP_PATH = { vi: [], en: [T.vi.language], zh: [T.vi.language, T.en.language] };

const shots = [];
const problems = [];

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: `${OUT}${name}.png` });
  shots.push(`apps/collector/.impeccable/review/${name}.png`);
  console.log(`  ${name}.png`);
}

/**
 * Taps the control whose label is exactly this text.
 *
 * Exact, not substring, and that is not fussiness: `register.intro` begins
 * "Tạo tài khoản người thu thập…" and the button beneath it says "Tạo tài
 * khoản", so a substring match picks the paragraph, clicks it, and the script
 * then screenshots a screen it thinks it has left.
 */
async function tap(page, text) {
  const target = page.getByText(text, { exact: true }).last();
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await target.click();
  await page.waitForTimeout(400);
}

/**
 * Taps by accessible name rather than by visible text.
 *
 * The Back control's visible string is "← Quay lại" — the arrow lives in the
 * same Text node — and its accessible name is the word alone. The name is the
 * more honest handle anyway: if this stops finding the control, the control has
 * lost its label, which is a fault worth failing on.
 */
async function tapLabel(page, label) {
  const target = page.getByLabel(label, { exact: true }).first();
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await target.click();
  await page.waitForTimeout(400);
}

/**
 * Scrolls the list under the pointer, not the document.
 *
 * `page.mouse.wheel` dispatches at wherever the pointer last was, and it starts
 * at 0,0. Every screen here scrolls inside a react-native-web `ScrollView` or
 * `FlatList` — its own overflow container, not the document — so a wheel event
 * delivered to the page body scrolled nothing at all, and two shots named for
 * rows further down the list were screenshots of the top of it. Putting the
 * pointer in the middle of the viewport first is the whole fix.
 */
async function scroll(page, dy) {
  const size = page.viewportSize();
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(500);
}

/**
 * Taps a control whose accessible ROLE is button and whose name is this text.
 *
 * The bottom bar's Uploads tab is labelled "Tải lên" and so is the control on
 * an episode row that opens the upload confirmation. `tap` takes the last
 * match, the bar renders after the list, and so the Vietnamese run clicked the
 * tab, re-entered the screen it was already on, and screenshot a confirmation
 * step it had never opened — while the English run, where the two strings are
 * "Uploads" and "Upload", worked. The tab carries `accessibilityRole="tab"`
 * and the row control carries `button`, so the role tells them apart in every
 * catalogue.
 */
async function tapButton(page, name) {
  const target = page.getByRole('button', { name, exact: true }).first();
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await target.click();
  await page.waitForTimeout(400);
}

function watch(page) {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED.test(m.text())) problems.push(`console: ${m.text()}`);
  });
}

async function open(browser, path) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  watch(page);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  return page;
}

/**
 * The pre-session screens, on their own harness routes because the mock has no
 * sign-in and the app under it opens past them. See `Harness.tsx`.
 */
async function preSession(browser, lang) {
  const t = T[lang];

  const landing = await open(browser, `/?screen=landing&lang=${lang}`);
  await shot(landing, `landing-${lang}`);
  // The second and third beats are reached by scrolling; 300px is inside the
  // first beat's travel, which is where the slogans are actually changing.
  await scroll(landing, 300);
  await shot(landing, `landing-scrolled-${lang}`);
  // The short end of the Android range this pilot ships to. The two buttons
  // are at the same place in both and neither needs a scroll to reach, which
  // is the gate these shots exist to prove. Reloaded, not just resized, so the
  // scroll above does not leak into the picture.
  await landing.setViewportSize(SHORT);
  await landing.reload({ waitUntil: 'networkidle' });
  await shot(landing, `landing-640-${lang}`);
  await landing.close();

  // "Remove animations" on: no beats, no scroll, all three sentences at once.
  // `react-native-web` answers `AccessibilityInfo.isReduceMotionEnabled()` from
  // `prefers-reduced-motion`, so emulating the media query is the real path
  // through the same code the phone runs.
  if (lang === 'vi') {
    const still = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    watch(still);
    await still.goto(`${BASE}/?screen=landing&lang=${lang}`, { waitUntil: 'networkidle' });
    await shot(still, `landing-reduced-${lang}`);
    await still.close();
  }

  const signin = await open(browser, `/?screen=signin&lang=${lang}`);
  await shot(signin, `signin-${lang}`);
  // The second step, with the code field and the Zalo sentence.
  await signin.locator('input').first().fill('0900000001');
  await tap(signin, t.sendCode);
  await shot(signin, `signin-code-${lang}`);
  await signin.close();
}

/**
 * The app itself, entered the way the mock enters it: the four onboarding
 * gates in order, then the four tab roots. Nothing is skipped and no state is
 * poked at — every gate below is one the server enforces too.
 */
async function session(browser, lang) {
  const t = T[lang];
  const page = await open(browser, '/');

  // APP-01 → APP-02 → APP-03 → APP-04, the order `startRoute` reads them in.
  // Always in Vietnamese: that is the app's default locale (LOC-01) and the
  // language chip lives on Home, so the walk to it happens before any flip.
  await page.locator('input').nth(0).fill('Nguyễn Văn A');
  await page.locator('input').nth(1).fill('0900000001');
  await tap(page, T.vi.createAccount);
  if (lang === 'vi') await shot(page, 'agreements-vi');
  for (const box of await page.locator('[role="switch"], input[type="checkbox"]').all()) {
    await box.click();
  }
  await tap(page, T.vi.acceptAll);
  await tap(page, T.vi.trainingDone);
  for (const box of await page.locator('[role="switch"], input[type="checkbox"]').all()) {
    await box.click();
  }
  await tap(page, T.vi.examSubmit);
  await tap(page, T.vi.hall);
  await page.waitForTimeout(600);

  for (const label of CHIP_PATH[lang]) await tap(page, label);
  await shot(page, `home-${lang}`);

  // The guide, offered once on Home after the first sign-in.
  await tap(page, t.guide);
  await shot(page, `guide-${lang}`);
  await tap(page, t.close);

  // The task hall, which is no longer a bar destination: the forum took its
  // slot and it is a chip in Home's "Nơi khác trong ứng dụng" row. It is at the
  // bottom of Home, hence the scroll — and reaching it this way is the check
  // that the displaced destination is still reachable.
  await scroll(page, 2400);
  await tapButton(page, t.hall);
  await shot(page, `taskhall-${lang}`);

  await tap(page, t.perMinute);
  await shot(page, `taskdetail-${lang}`);
  // Two pops now, not one: the hall is pushed on top of Home rather than being
  // a root of its own, so the bar is only back when Home is.
  await tapLabel(page, t.back);
  await tapLabel(page, t.back);

  // The forum, and the group chats hanging off its header. Both are previews
  // with no service behind them; what these shots are for is the layout, the
  // Vietnamese copy and the sentence each dead control answers with.
  await tap(page, t.forum);
  await shot(page, `forum-${lang}`);
  await tapButton(page, t.filterAnswered);
  await shot(page, `forum-answered-${lang}`);
  await tapButton(page, t.filterAll);
  // The floating compose action. It opens nothing, and says so.
  await tapLabel(page, t.compose);
  await shot(page, `forum-notconnected-${lang}`);

  await tapButton(page, t.groups);
  await shot(page, `groups-${lang}`);
  await tap(page, 'Điểm hỗ trợ Quận 7');
  await shot(page, `groupthread-${lang}`);
  await tapLabel(page, t.back);
  // The announcements channel, whose composer says operators only — the one
  // place the collector/operator split is visible in this app.
  await tap(page, 'Thông báo Player One');
  await shot(page, `groupthread-announce-${lang}`);
  await tapLabel(page, t.back);
  await tapLabel(page, t.back);

  await tap(page, t.uploads);
  await shot(page, `uploads-${lang}`);
  // APP-25's confirmation step, and APP-27's server-supplied reject reason,
  // are both further down the list. They are the two things on this screen
  // that a reviewer of the design has to be able to see.
  await tapButton(page, t.upload);
  await shot(page, `uploads-confirm-${lang}`);
  await scroll(page, 1600);
  await shot(page, `uploads-rejected-${lang}`);

  await tap(page, t.income);
  await shot(page, `income-${lang}`);
  // The estimated row: dashed, muted, labelled, below the confirmed ones.
  await scroll(page, 1400);
  await shot(page, `income-estimated-${lang}`);

  // 320×640, in Vietnamese: the narrowest bar the pilot ships to, with the
  // longest of the three catalogues in it. This is the picture the navigation
  // decision was made against, so it is taken rather than argued.
  if (lang === 'vi') {
    await page.setViewportSize(NARROW);
    await tap(page, t.forum);
    await shot(page, 'forum-320-vi');
    await tapButton(page, t.groups);
    await shot(page, 'groups-320-vi');
    await tap(page, 'Kịch bản: Nhà bếp');
    await shot(page, 'groupthread-320-vi');
  }

  await page.close();
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
for (const lang of ['vi', 'en', 'zh']) {
  console.log(lang);
  await preSession(browser, lang);
  await session(browser, lang);
}
await browser.close();

console.log(`\n${shots.length} shots in apps/collector/.impeccable/review/`);
if (problems.length > 0) {
  console.error(`\n${new Set(problems).size} distinct console/page errors:`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exitCode = 1;
}
