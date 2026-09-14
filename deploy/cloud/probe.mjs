import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';

const result = (level, check, message) => ({ level, check, message });
export async function webChecks(env) {
  const origin = new URL(env.PLAYERONE_PUBLIC_URL), findings = [];
  const request = (path, options = {}) => fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000), ...options });
  const check = async (name, fn) => {
    try { findings.push(result('PASS', name, await fn() ?? 'verified')); }
    catch (error) { findings.push(result('FAIL', name, error.message)); }
  };
  if (origin.protocol !== 'https:') {
    for (const name of ['HTTPS redirect', 'certificate']) findings.push(result('SKIPPED', name, 'non-TLS local origin; real DNS and ACME required'));
  } else {
    await check('HTTPS redirect', async () => {
      const http = new URL(origin); http.protocol = 'http:'; http.port = '';
      const response = await fetch(http, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      assert.ok([301, 302, 307, 308].includes(response.status));
      assert.equal(new URL(response.headers.get('location'), http).origin, origin.origin);
    });
    await check('certificate', () => new Promise((resolve, reject) => {
      const socket = connect({ host: origin.hostname, port: Number(origin.port || 443), servername: origin.hostname, rejectUnauthorized: true }, () => {
        const cert = socket.getPeerCertificate(); socket.end();
        const expires = new Date(cert.valid_to);
        if (!socket.authorized || expires.getTime() <= Date.now()) reject(new Error('Invalid or expired certificate'));
        else resolve(`valid chain and hostname; expiry ${expires.toISOString()}`);
      });
      socket.setTimeout(10000, () => socket.destroy(new Error('TLS timeout')));
      socket.on('error', reject);
    }));
  }
  await check('headers', async () => {
    for (const path of ['/episodes', '/healthz', '/whoami']) {
      const response = await request(path);
      for (const [name, value] of Object.entries({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' })) assert.equal(response.headers.get(name), value, `${path}: ${name}`);
      const csp = response.headers.get('content-security-policy') ?? '';
      for (const rule of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(rule), `${path}: CSP ${rule}`);
      if (origin.protocol === 'https:') assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=31536000; includeSubDomains/);
    }
  });
  await check('/healthz', async () => {
    const response = await request('/healthz'); assert.equal(response.status, 200); assert.equal((await response.json()).ready, true);
  });
  const signIn = async (path, body) => {
    const response = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, path);
    const { token } = await response.json(); assert.ok(token, `${path} token missing`); return `Bearer ${token}`;
  };
  await check('authenticated console machine + operator tokens', async () => {
    assert.equal((await request('/whoami')).status, 401);
    const machine = await signIn('/auth/machine', { machine_identifier: env.PLAYERONE_MACHINE_IDENTIFIER, secret: env.PLAYERONE_MACHINE_SECRET });
    const operator = await signIn('/auth/operator', { external_ref: env.PLAYERONE_OPERATOR_REF, secret: env.PLAYERONE_OPERATOR_SECRET });
    for (const path of ['/whoami', '/api/episodes']) {
      const response = await request(path, { headers: { 'x-machine-token': machine, authorization: operator } });
      assert.equal(response.status, 200, path);
      const body = await response.json();
      if (path === '/whoami') assert.equal(body.role, 'operator');
    }
  });
  await check('reviewer role reaches origin', async () => {
    const session = await request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: origin.origin },
      body: JSON.stringify({ role: 'reviewer', external_ref: 'rev-1', operator_secret: env.PLAYERONE_DEMO_REVIEWER_SECRET }) });
    assert.equal(session.status, 200); assert.equal((await session.json()).role, 'reviewer');
    const cookie = session.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie);
    const response = await request('/whoami', { headers: { cookie } });
    assert.equal(response.status, 200); assert.equal((await response.json()).role, 'reviewer');
    return 'reviewer token accepted from this host; remote reviewer network still needs an owner check';
  });
  await check('nested GET /episodes SPA', async () => {
    const response = await request('/episodes'); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text(); assert.match(html, /id="root"/); assert.match(html, /<script[^>]+type="module"/);
  });
  return findings;
}

async function bucket(env) {
  const require = createRequire(new URL('../../packages/api/package.json', import.meta.url));
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({ region: 'auto', endpoint: env.STORAGE_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: env.STORAGE_KEY, secretAccessKey: env.STORAGE_SECRET } });
  const object = { Bucket: env.STORAGE_BUCKET, Key: `cloud-probe/${randomUUID()}` };
  const bytes = Buffer.from(`PlayerOne storage probe ${randomUUID()}`);
  const hash = b => createHash('sha256').update(b).digest('hex');
  let version;
  try {
    version = (await client.send(new PutObjectCommand({ ...object, Body: bytes }))).VersionId;
    const response = await client.send(new GetObjectCommand(object));
    assert.equal(hash(await response.Body.transformToByteArray()), hash(bytes));
    console.log(`PASS bucket PUT + read-back SHA-256 ${hash(bytes)}`);
  } finally {
    try {
      await client.send(new DeleteObjectCommand({ ...object, VersionId: version }));
      await assert.rejects(client.send(new HeadObjectCommand(object)), e => e.$metadata?.httpStatusCode === 404);
      console.log(`PASS probe cleanup ${object.Key}`);
    } finally { client.destroy(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'bucket') await bucket(process.env);
    else {
      const findings = await webChecks(process.env);
      for (const f of findings) console.log(`${f.level} ${f.check}: ${f.message}`);
      if (findings.some(f => f.level === 'FAIL')) process.exitCode = 1;
    }
  } catch (error) { console.error(`FAIL ${process.argv[2]}: ${error.message}`); process.exitCode = 1; }
}
