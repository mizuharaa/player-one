import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShowcaseServer } from './http-server.mjs';

/**
 * The independent deploy listener's browser policy: one CSP, on every kind of
 * path it serves.
 *
 * ## Why this file used to fail AND HANG, which is what the audit of `4a32929`
 * found (MED-9)
 *
 * It pointed `distDir` at `apps/console/dist`, a build this repository does not
 * produce unless somebody runs it, so on a fresh checkout
 * `createShowcaseServer` threw `ENOENT` on `realpath`. That alone would be a
 * fair red test — but the fake API server was created and LISTENING on the line
 * before, outside the `try`, so nothing ever closed it. The `node:test` runner
 * then sat on an open handle forever: the whole `node --test deploy/*.test.mjs`
 * gate stopped at this file rather than reporting a failure, which is worse
 * than a failure because it hides every file after it.
 *
 * Two changes, and each fixes one half:
 *
 *   - **The fixture is self-contained.** A temporary directory with an
 *     `index.html` and an `assets/` folder is all this test ever needed: what
 *     it asserts is the HEADERS on a served page, an SPA fallback, a proxied
 *     API path and two misses. None of that is about the console's real
 *     bundle, so depending on a build was a prerequisite it never used.
 *   - **Every resource is created inside the `try`**, and `finally` closes
 *     whatever exists. A throw halfway through now leaves no listening socket
 *     and no temporary directory behind, so this file can fail without taking
 *     the runner with it.
 */
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const close = (s) =>
  s === undefined ? Promise.resolve() : new Promise((r) => { s.closeAllConnections(); s.close(r); });

test('independent deploy browser policy on SPA, API, media and errors', async () => {
  /** Declared before the `try` so `finally` can close whatever got created. */
  let api;
  let web;
  let dist;
  try {
    dist = mkdtempSync(join(tmpdir(), 'playerone-deploy-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>console</title>');

    api = createServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized"}');
    });
    const apiPort = await listen(api);
    web = await createShowcaseServer({ distDir: dist, apiPort, secure: true });
    const port = await listen(web);

    for (const path of ['/login', '/discover', '/api/operator/profile', '/assets/missing.js', '/.env']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const policy = res.headers.get('content-security-policy');
      for (const directive of [
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ]) {
        assert.ok(policy.includes(directive), path + ': ' + directive);
      }
      const scriptSources = policy.split('script-src')[1].split(';')[0].trim().split(/\s+/);
      assert.ok(!scriptSources.includes("'unsafe-inline'"));
      assert.ok(!scriptSources.includes("'unsafe-eval'"));
      assert.ok(!scriptSources.includes("'wasm-unsafe-eval'"));
      assert.ok(!policy.includes('spline.design'));
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(res.headers.get('strict-transport-security').includes('max-age=31536000'));
      await res.arrayBuffer();
    }
  } finally {
    await close(web);
    await close(api);
    if (dist !== undefined) rmSync(dist, { recursive: true, force: true });
  }
});
