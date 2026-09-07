/**
 * One command that ends with a console you can click through.
 *
 *   DATABASE_URL=... pnpm demo
 *
 * The three shells in `docs/RUNNING.md` are correct and they are also three
 * chances to drop a variable. The one that was actually dropped is
 * `REVIEW_VERIFICATION_GATE=local`: the served default is `cloud`, seeded
 * footage has no cloud read-back receipt, and the result is a `/review` that
 * says "Nothing to review" on a database that has a queue in it. This script
 * exists so that variable cannot be forgotten.
 *
 * It runs the seed in this process (so the media root it makes is the media
 * root the server is given), then starts the API and the Vite dev server as
 * children and leaves them running until Ctrl-C.
 *
 * `seed-console.mjs` **truncates every table**. Point `DATABASE_URL` at a
 * throwaway database.
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if ((process.env['DATABASE_URL'] ?? '') === '') {
  console.error(`DATABASE_URL is not set.

  # bash
  export DATABASE_URL='postgres://postgres:<password>@localhost:5432/<a throwaway database>'
  # PowerShell
  $env:DATABASE_URL = "postgres://postgres:<password>@localhost:5432/<a throwaway database>"

A password with '@' or ':' in it must be percent-encoded — '@' is '%40'.
Then: pnpm db:migrate && pnpm demo`);
  process.exit(2);
}

/**
 * Made here rather than by the seed, because both halves need the same path:
 * the seed junctions the session directories into it and the server resolves
 * `/media/episode/:id/part/:index` out of it.
 */
process.env['PLAYERONE_MEDIA_ROOT'] ??= await mkdtemp(join(tmpdir(), 'playerone-demo-'));
/** The seed's own "now run these two shells" block would contradict what happens next. */
process.env['PLAYERONE_SEED_QUIET'] = '1';

/** The seed is a script, not a library. Importing it runs it, which is the point. */
const { summary } = await import('./seed-console.mjs');

const REPO = join(import.meta.dirname, '..', '..', '..');
const children = [];
/**
 * One command string rather than a command and an args array: on Windows
 * `pnpm` is a `.cmd` and needs `shell`, and `shell` with an args array is
 * Node's DEP0190. Nothing here takes an argument from outside this file.
 */
const start = (name, command, env) => {
  const child = spawn(command, {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: true,
  });
  child.on('exit', (code) => console.log(`${name} exited (${code})`));
  children.push(child);
  return child;
};

start('api', 'node packages/api/bin/serve.ts', {
  PLAYERONE_TOKEN_SECRET: process.env['PLAYERONE_TOKEN_SECRET'] ?? 'dev',
  /**
   * Not a default and not a loosening. ADR 0001 allows the local gate on a
   * machine with no bucket, and this is one by definition — the seed's footage
   * has never been uploaded. A cloud copy that failed read-back is still
   * refused under this gate; only "no cloud copy at all" is admitted.
   */
  REVIEW_VERIFICATION_GATE: 'local',
});
/**
 * `PORT` is passed through so a machine already running an API on 8080 can
 * demonstrate on another port without editing anything, and the console's
 * proxy is told the same number — otherwise it silently proxies to the other
 * server and the demonstration shows somebody else's database.
 */
const apiPort = process.env['PORT'] ?? '8080';
start('console', 'pnpm -F @playerone/console dev', {
  PLAYERONE_API: `http://127.0.0.1:${apiPort}`,
});

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(`
════════════════════════════════════════════════════════════════════════
  PlayerOne demonstration — seeded, and now serving

  Console      http://localhost:5173      (never http://127.0.0.1:${apiPort} —
                                           the session cookies are
                                           SameSite=Strict and only the
                                           Vite origin gets them)
  Footage      ${summary.source === 'real' ? 'REAL — the sample corpus' : 'FIXTURES — 32-byte stubs, playback will not work'}
               ${summary.sourceRoot}
  Media root   ${summary.mediaRoot}
  Period       ${summary.period}

  Sign in as "Upload centre", machine HCM-01 / pw, then

    op-1  / pw    /  ·  /review  ·  /episodes  ·  /backoffice  ·  /pipeline  ·  /counter
    fin-1 / pw    /settle  ·  /settle/preflight  ·  /settle/bills/…  ·  /settle/exceptions  ·  /risk
    rev-1 / pw    /review only — switch the toggle to "Reviewer" and leave the
                  machine fields alone; a reviewer belongs to no upload centre

  What is there to see
    ${summary.queueStandard} episode(s) waiting in the standard review queue, ${summary.queuePrivacy} in the privacy queue
    ${summary.decided} verdict(s) already taken — one of each kind — worth ${summary.settled}
    ${summary.needsHuman} episode(s) the resolver refused to guess on, on /episodes
    ${summary.bills} bill(s), ${summary.paid} recorded as paid, ${summary.notPayable} settlement(s) not payable
    ${summary.riskFlags} risk flag(s) the engine raised itself over ${summary.riskEvaluated} subject(s)

  The collector app is a separate surface and needs none of this:
    pnpm -F @playerone/collector web      then  http://localhost:5177

  Ctrl-C stops both servers. The database keeps what was seeded.
════════════════════════════════════════════════════════════════════════
`);
