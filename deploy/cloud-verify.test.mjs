import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { webChecks } from './cloud/probe.mjs';
import { demoUrl, isolatedUrl } from './cloud/ops.mjs';

test('destructive jobs cannot select the demo or an arbitrary database', () => {
  const url = 'postgres://owner:secret@postgres/po_demo_cloud';
  assert.throws(() => demoUrl('postgres://owner:secret@postgres/production'));
  for (const name of ['po_demo_cloud', 'postgres', 'po_e2e_cloud_x;drop database x', 'po_e2e_cloud_' + 'a'.repeat(64)]) {
    assert.throws(() => isolatedUrl(url, name, 'po_e2e_cloud_'));
  }
  assert.equal(isolatedUrl(url, 'po_e2e_cloud_abc', 'po_e2e_cloud_').pathname, '/po_e2e_cloud_abc');
});
test('HTTP proof skips TLS, checks protected access and detects broken headers or SPA', async () => {
  let broken = false;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    for (const [k, v] of Object.entries({ 'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' })) res.setHeader(k, v);
    if (broken) res.removeHeader('x-frame-options');
    if (req.url === '/healthz') return res.end('{"ready":true}');
    if (req.url.startsWith('/auth/')) return res.end('{"token":"test-token"}');
    if (req.url === '/whoami') {
      if (!req.headers.authorization) { res.statusCode = 401; return res.end('{}'); }
      return res.end('{"role":"administrator"}');
    }
    if (req.url === '/api/episodes') return res.end('[]');
    res.setHeader('content-type', 'text/html');
    res.end(broken ? 'missing application' : '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = { PLAYERONE_PUBLIC_URL: `http://127.0.0.1:${server.address().port}` };
  try {
    const good = await webChecks(env);
    assert.equal(good.find(x => x.check === 'certificate').level, 'SKIPPED');
    assert.equal(good.find(x => x.check === 'HTTPS redirect').level, 'SKIPPED');
    assert.equal(good.some(x => x.level === 'FAIL'), false);
    broken = true;
    const bad = await webChecks(env);
    assert.equal(bad.find(x => x.check === 'headers').level, 'FAIL');
    assert.equal(bad.find(x => x.check === 'nested GET /episodes SPA').level, 'FAIL');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
