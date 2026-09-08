/**
 * One headless browser at a time, and never a leaked one.
 *
 * Two faults, both observed on this machine rather than imagined:
 *
 * 1. **Leaks.** Every script here launched at top level and closed at the
 *    bottom with nothing in between, so any throw — a nav timeout, a selector
 *    that never appeared, a dev server restarting mid-run — walked past the
 *    close and left a browser plus its renderer children alive. They
 *    accumulated to 55 processes and 11 GB once, and the OS killed the dev
 *    servers to reclaim it.
 *
 * 2. **Stampede.** `shots.mjs`, `rhythm.mjs` and `contrast.mjs` are run by
 *    different agents in different panes with no coordination. Each opens its
 *    own browser and drives several viewports; three at once saturates the
 *    machine, and the owner reported 70–80% CPU with everything else lagging.
 *    A previous run also lost four measurements to a 30 s screenshot timeout
 *    caused by nothing but contention.
 *
 * So: a cross-process lock (one browser anywhere on the box) plus guaranteed
 * teardown on every exit path, including SIGINT and an uncaught throw.
 *
 *   import { withBrowser } from './browser.mjs';
 *   await withBrowser(async (browser) => { ... });
 *
 * `PLAYERONE_BROWSER_LOCK=0` opts out for a deliberate parallel run.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(tmpdir(), 'playerone-browser.lock');
/**
 * An age-based steal broke mutual exclusion, which is the whole job.
 *
 * The first version treated a lock as stale once it was older than ten
 * minutes **even when its owner was still alive and working**. A full
 * `shots.mjs` walk plus a contrast sweep runs well past that, so a waiter
 * would delete a live holder's lock, take it, and launch a second browser
 * beside the first. Observed: a holder 95 minutes into a legitimate run and
 * five `chrome-headless-shell` processes at once — the exact contention the
 * lock exists to prevent, caused by the lock.
 *
 * Liveness is the real signal: a holder whose process is gone can never
 * release, and nothing else may take its place. The age check survives only
 * as an emergency valve, set far beyond any real run, and it announces itself
 * when it fires rather than stealing quietly.
 */
const STALE_MS = 45 * 60 * 1000;
const POLL_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A lock whose owner died is not a lock. Windows has no `kill -0`, so ask. */
function holderAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquire() {
  if (process.env['PLAYERONE_BROWSER_LOCK'] === '0') return () => {};
  mkdirSync(tmpdir(), { recursive: true });
  for (;;) {
    try {
      writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return () => rmSync(LOCK, { force: true });
    } catch {
      let stale = true;
      try {
        const held = JSON.parse(readFileSync(LOCK, 'utf8'));
        const dead = !holderAlive(held.pid);
        const ancient = Date.now() - held.at > STALE_MS;
        stale = dead || ancient;
        if (dead) {
          process.stderr.write(`browser lock holder ${held.pid} is gone; taking it\n`);
        } else if (ancient) {
          /* Loud, because it means a real run is being overtaken. */
          process.stderr.write(
            `browser lock held by LIVE pid ${held.pid} for over ${STALE_MS / 60000} minutes; ` +
              `overriding. If this is not a hung process, that run is now sharing the machine.\n`,
          );
        } else {
          const mins = ((Date.now() - held.at) / 60000).toFixed(1);
          process.stderr.write(`waiting for the browser lock (pid ${held.pid}, held ${mins}m)…\n`);
        }
      } catch {
        /* Unreadable means half-written or truncated; treat as stale. */
      }
      if (stale && existsSync(LOCK)) rmSync(LOCK, { force: true });
      await sleep(POLL_MS);
    }
  }
}

/**
 * The two halves, exported separately.
 *
 * `withBrowser` is the shape to prefer, but the three existing scripts launch
 * at module top level and close 200 lines later, and restructuring them while
 * an agent is running them is how you break a verification mid-flight. So they
 * take these two calls instead: three added lines, no reshaping.
 */
export const acquireLock = acquire;

/** Close this browser on every exit path, and release the lock with it. */
export function guard(browser, release) {
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
    release?.();
  };
  process.once('SIGINT', () => void close().finally(() => process.exit(130)));
  process.once('SIGTERM', () => void close().finally(() => process.exit(143)));
  process.once('uncaughtException', (e) =>
    void close().finally(() => {
      console.error(e);
      process.exit(1);
    }),
  );
  process.once('exit', () => release?.());
  return close;
}

export async function withBrowser(fn, launchOptions = {}) {
  const release = await acquire();
  const browser = await chromium.launch(launchOptions);

  /*
   * `finally` alone does not cover Ctrl-C or a process-level throw, and those
   * are exactly how an interrupted verification run used to leak. Close on
   * every path, and only once.
   */
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
    release();
  };
  const onSignal = () => {
    void close().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('uncaughtException', (e) => {
    void close().finally(() => {
      console.error(e);
      process.exit(1);
    });
  });

  try {
    return await fn(browser);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await close();
  }
}
