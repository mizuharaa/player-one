import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShowcaseServer } from './http-server.mjs';

function listen(server) {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
}
function close(server) { return new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }); }
function fetchRaw(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('showcase routing, session transport and static media boundaries', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'playerone-showcase-'));
  const dist = join(temp, 'dist');
  const outside = join(temp, 'private');
  await mkdir(dist);
  await mkdir(outside);
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>PlayerOne SPA</title>');
  await writeFile(join(dist, 'film.mp4'), '0123456789');
  await writeFile(join(dist, 'empty.mp4'), '');
  await writeFile(join(dist, 'debug.js.map'), 'do not expose source');
  await writeFile(join(outside, 'secret.txt'), 'outside-static-root');
  await symlink(outside, join(dist, 'linked'), 'junction');
  const api = createServer(async (req, res) => {
    if (req.url === '/whoami') { res.writeHead(401); res.end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(200, { 'content-type': 'application/json',
      'set-cookie': ['operator=demo; Path=/; HttpOnly; Secure; SameSite=Strict', 'machine=demo; Path=/; HttpOnly; Secure; SameSite=Strict'] });
    res.end(JSON.stringify({ url: req.url, method: req.method, cookie: req.headers.cookie, host: req.headers.host,
      address: req.headers['x-forwarded-for'], forwarded: req.headers.forwarded, realIp: req.headers['x-real-ip'], body }));
  });
  const apiPort = await listen(api);
  const server = await createShowcaseServer({ distDir: dist, apiPort, secure: true });
  const port = await listen(server);
  t.after(async () => { await close(server); await close(api); await rm(temp, { recursive: true, force: true }); });

  await t.test('bare episodes is SPA; slash paths and every API root proxy', async () => {
    const page = await fetchRaw(port, '/episodes?state=stuck');
    assert.equal(page.status, 200);
    assert.match(page.body, /PlayerOne SPA/);
    assert.equal(page.headers['cache-control'], 'no-store');
    for (const path of ['/episodes/stuck', '/api/tasks', '/auth/login', '/media/video', '/reference/sync', '/handovers', '/upload-batches']) {
      const response = await fetchRaw(port, `${path}?page=2`);
      assert.equal(JSON.parse(response.body).url, `${path}?page=2`);
    }
    assert.match((await fetchRaw(port, '/apiary')).body, /PlayerOne SPA/);
  });

  await t.test('POST bodies, host, cookies and multiple Set-Cookie headers survive unchanged', async () => {
    const response = await fetchRaw(port, '/auth/login', { method: 'POST',
      headers: { host: 'showcase.example', cookie: 'operator=existing', 'content-type': 'application/json' }, body: '{"code":"123456"}' });
    assert.deepEqual(JSON.parse(response.body), { url: '/auth/login', method: 'POST', cookie: 'operator=existing', host: 'showcase.example', address: '127.0.0.1', body: '{"code":"123456"}' });
    assert.equal(response.headers['set-cookie'].length, 2);
    assert.match(response.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  });

  await t.test('forwarding ignores spoofed chains and accepts only configured edge single-IP identity', async () => {
    const forged = { 'x-forwarded-for': '192.0.2.200, 192.0.2.201', forwarded: 'for=192.0.2.202', 'x-real-ip': '198.51.100.4' };
    const direct = JSON.parse((await fetchRaw(port, '/auth/login', { headers: forged })).body);
    assert.equal(direct.address, '127.0.0.1');
    assert.equal(direct.forwarded, undefined);
    assert.equal(direct.realIp, undefined);
    const railway = await createShowcaseServer({ distDir: dist, apiPort, secure: true, proxyMode: 'railway' });
    const railwayPort = await listen(railway);
    try {
      const edge = JSON.parse((await fetchRaw(railwayPort, '/auth/login', { headers: forged })).body);
      assert.equal(edge.address, '198.51.100.4');
      assert.equal(edge.forwarded, undefined);
      assert.equal(edge.realIp, undefined);
      const second = JSON.parse((await fetchRaw(railwayPort, '/auth/login', { headers: { ...forged, 'x-real-ip': '198.51.100.5' } })).body);
      assert.notEqual(second.address, edge.address);
      assert.equal((await fetchRaw(railwayPort, '/auth/login', { headers: { ...forged, 'x-real-ip': '198.51.100.4, 192.0.2.200' } })).status, 400);
      assert.equal((await fetchRaw(railwayPort, '/auth/login')).status, 400);
    } finally { await close(railway); }
  });

  await t.test('MP4 bounded, suffix, open-ended ranges and RFC conditional handling', async () => {
    for (const [range, expected, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
    ]) {
      const response = await fetchRaw(port, '/film.mp4', { headers: { range } });
      assert.equal(response.status, 206);
      assert.equal(response.body, expected);
      assert.equal(response.headers['content-range'], contentRange);
      assert.equal(response.headers['content-type'], 'video/mp4');
      assert.equal(Number(response.headers['content-length']), expected.length);
    }
    const head = await fetchRaw(port, '/film.mp4', { method: 'HEAD', headers: { range: 'bytes=2-5' } });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], '10');
    const invalid = await fetchRaw(port, '/film.mp4', { headers: { range: 'bytes=20-' } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers['content-range'], 'bytes */10');
    assert.equal((await fetchRaw(port, '/empty.mp4', { headers: { range: 'bytes=0-' } })).status, 416);
    assert.equal((await fetchRaw(port, '/film.mp4', { headers: { range: 'bytes=2-5', 'if-range': 'Thu, 01 Jan 1970 00:00:00 GMT' } })).status, 200);
    assert.equal((await fetchRaw(port, '/film.mp4', { headers: { range: 'bytes=2-5', 'if-range': 'Fri, 01 Jan 2100 00:00:00 GMT' } })).status, 200);
    assert.equal((await fetchRaw(port, '/film.mp4', { headers: { range: 'items=2-5' } })).status, 200);
    assert.equal((await fetchRaw(port, '/film.mp4', { headers: { range: 'bytes=2-5', 'if-range': head.headers['last-modified'] } })).status, 206);
  });

  await t.test('traversal, symlink escapes, source maps and asset misses never return SPA or secrets', async () => {
    for (const path of ['/../private/secret.txt', '/%2e%2e/private/secret.txt', '/%5c..%5cprivate/secret.txt']) {
      assert.equal((await fetchRaw(port, path)).status, 400);
    }
    for (const path of ['/.env', '/linked/secret.txt', '/debug.js.map', '/missing.mp4', '/assets/missing.js']) {
      const response = await fetchRaw(port, path);
      assert.equal(response.status, 404);
      assert.doesNotMatch(response.body, /outside-static-root|PlayerOne SPA/);
    }
    assert.equal((await fetchRaw(port, '/episodes', { method: 'POST' })).status, 405);
  });

  await t.test('health is ready only while the API listener answers its auth guard', async () => {
    const ready = await fetchRaw(port, '/healthz');
    assert.equal(ready.status, 200);
    assert.deepEqual(JSON.parse(ready.body), { ready: true });
    assert.match(ready.headers['strict-transport-security'], /max-age=/);
    await close(api);
    const down = await fetchRaw(port, '/healthz');
    assert.equal(down.status, 503);
    assert.deepEqual(JSON.parse(down.body), { ready: false });
    assert.equal((await fetchRaw(port, '/api/tasks')).status, 502);
  });
});
