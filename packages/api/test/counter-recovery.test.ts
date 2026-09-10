import { createServer, type IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { parseRecoveryArgs } from '../bin/counter.ts';
import { argsFor, flags, runCounter } from './counter-cli-helpers.ts';

const id = '55555555-5555-4555-8555-555555555555';
const page = { attempted: 1, confirmed: 1, failed_object_keys: [], query_failed: false,
  audit_recorded: true, next_after: null };
const secrets = { PLAYERONE_MACHINE_SECRET: 'machine-private-credential', PLAYERONE_OPERATOR_SECRET: 'operator-private-credential' };

async function endpoint(status: number, body: unknown, authFailure = false) {
  const requests: { path: string; method: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    requests.push({ path: req.url!, method: req.method!, headers: req.headers, body: input ? JSON.parse(input) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/machine' && !authFailure) res.end('{"token":"machine-token"}');
    else if (req.url === '/auth/operator' && !authFailure) res.end('{"token":"operator-token"}');
    else { res.statusCode = status; res.end(raw); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing socket address');
  return { requests, raw, api: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

function output(result: Awaited<ReturnType<typeof runCounter>>) {
  const lines = result.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  const summary = JSON.parse(lines[0]!);
  for (const value of [...Object.values(secrets), 'machine-token', 'operator-token']) {
    expect(result.stdout + result.stderr).not.toContain(value);
  }
  return summary;
}

describe('counter recovery (socket only, no database)', () => {
  it.each([
    ['upload', '--batch', 'wrong'], ['upload', '--batch', id, '--after', 'key'],
    ['archive-retry', '--bill', id, '--after', ''],
    ['archive-retry', '--bill', id, '--after', 'x\nkey'],
    ['archive-retry', '--bill', id, '--after', 'ế'.repeat(342)],
    ['upload', '--batch', id, '--api', 'https://user:secret@example.com'],
    ['upload', '--batch', id, '--api', 'ftp://example.com'],
    ['archive-retry', '--bill', id, '--api', 'http://localhost?secret=x'],
  ].map((args) => ({ args })) )('rejects invalid arguments before network: $args', async ({ args }) => {
    expect(() => parseRecoveryArgs(args)).toThrow();
    const h = await endpoint(200, {});
    try {
      const result = await runCounter([...args, ...(args.includes('--api') ? [] : ['--api', h.api])], secrets);
      expect(result.code).toBe(2);
      expect(output(result).failed_step).toBe('usage');
      expect(h.requests).toEqual([]);
    } finally { await h.close(); }
  });

  it.each([
    { status: 200, body: { cloud_verified: true }, code: 0 },
    { status: 200, body: { cloud_verified: false, episodes: [{ error: 'checksum mismatch' }] }, code: 1 },
    { status: 200, body: { cloud_verified: 'true' }, code: 1 },
    { status: 200, body: 'broken JSON', code: 1 },
    { status: 500, body: { error: 'failed', ref: 'upload-reference' }, code: 1 },
    { status: 404, body: { error: 'no such batch on this machine' }, code: 1 },
  ])('upload status=$status body=$body exits $code', async ({ status, body, code }) => {
    const h = await endpoint(status, body);
    try {
      const result = await runCounter(['upload', '--batch', id, '--api', h.api], secrets);
      expect(result.code).toBe(code);
      expect(output(result)).toMatchObject({ command: 'upload', batch_id: id, failed_step: code === 0 ? null : 'upload' });
      expect(h.requests.map((r) => [r.method, r.path])).toEqual([
        ['POST', '/auth/machine'], ['POST', '/auth/operator'], ['POST', `/upload-batches/${id}/upload`],
      ]);
      expect(h.requests[0]!.body).toEqual({ machine_identifier: 'HCM-01', secret: secrets.PLAYERONE_MACHINE_SECRET });
      expect(h.requests[1]!.body).toEqual({ external_ref: 'op-1', secret: secrets.PLAYERONE_OPERATOR_SECRET });
      expect(h.requests[2]!.body).toBeNull();
      expect(h.requests[2]!.headers).toMatchObject({ authorization: 'Bearer operator-token', 'x-machine-token': 'Bearer machine-token' });
      expect(result.stderr).toContain(h.raw);
      if (status === 200 && typeof body === 'object' && body.cloud_verified === false) {
        expect(result.stderr).toContain('Upload was not cloud verified');
      }
    } finally { await h.close(); }
  });

  it.each([
    { status: 200, body: page, code: 0, state: 'page_complete' },
    { status: 200, body: { ...page, next_after: 'episodes/path/key' }, code: 0, state: 'more_pages' },
    { status: 200, body: { ...page, confirmed: 0, failed_object_keys: ['failed/key'] }, code: 1, state: 'failed' },
    { status: 200, body: { ...page, query_failed: true }, code: 1, state: 'failed' },
    { status: 200, body: { ...page, audit_recorded: false }, code: 1, state: 'failed' },
    { status: 200, body: { ...page, confirmed: 2 }, code: 1, state: 'failed' },
    { status: 200, body: { attempted: 0 }, code: 1, state: 'failed' },
    { status: 200, body: 'broken JSON', code: 1, state: 'failed' },
    { status: 503, body: { ...page, audit_recorded: false, error: 'audit persistence failed', ref: 'partial-reference' }, code: 1, state: 'failed' },
    { status: 403, body: { error: 'administrator only' }, code: 1, state: 'failed' },
  ])('archive status=$status body=$body exits $code ($state)', async ({ status, body, code, state }) => {
    const h = await endpoint(status, body);
    const after = 'episodes/ế +%?&/key';
    try {
      const result = await runCounter(['archive-retry', '--bill', id, '--after', after, '--api', h.api], secrets);
      expect(result.code).toBe(code);
      expect(output(result)).toMatchObject({ command: 'archive-retry', bill_id: id, page_status: state,
        failed_step: code === 0 ? null : 'archive-retry' });
      expect(h.requests.map((r) => r.path)).toEqual(['/auth/machine', '/auth/operator',
        `/api/settle/bills/${id}/archive/retry?after=${encodeURIComponent(after)}`]);
      expect(h.requests.every((r) => r.method === 'POST')).toBe(true);
      expect(h.requests[2]!.body).toBeNull();
      expect(h.requests[2]!.headers).toMatchObject({ authorization: 'Bearer operator-token', 'x-machine-token': 'Bearer machine-token' });
      expect(result.stderr).toContain(h.raw);
      if (status === 200 && typeof body === 'object' && 'failed_object_keys' in body
        && (body.failed_object_keys.length > 0 || body.query_failed || !body.audit_recorded)) {
        expect(result.stderr).toContain('Archive page has unconfirmed results; inspect the response before retrying');
      }
      if (code === 0) expect(result.stderr).toContain('not actual storage tier');
    } finally { await h.close(); }
  });

  it('stops after refused authentication', async () => {
    const h = await endpoint(401, { error: 'sign-in refused', ref: 'auth-reference' }, true);
    try {
      const result = await runCounter(['upload', '--batch', id, '--api', h.api], secrets);
      expect(result.code).toBe(1);
      expect(output(result).failed_step).toBe('auth/machine');
      expect(h.requests.map((r) => r.path)).toEqual(['/auth/machine']);
      expect(result.stderr).toContain('auth-reference');
    } finally { await h.close(); }
  });

  it('prints a created batch receipt while import upload is still waiting', async () => {
    let releaseUpload!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseUpload = resolve; });
    let receiptSeen!: () => void;
    const receipt = new Promise<void>((resolve) => { receiptSeen = resolve; });
    let uploadSeen!: () => void;
    const uploading = new Promise<void>((resolve) => { uploadSeen = resolve; });
    let batchId = '';
    const server = createServer(async (req, res) => {
      let input = '';
      for await (const chunk of req) input += chunk;
      if (req.url === '/auth/machine' || req.url === '/auth/operator') res.end('{"token":"test-token"}');
      else if (req.url === '/upload-batches') { batchId = JSON.parse(input).id; res.end('{}'); }
      else if (req.url?.endsWith('/upload')) { uploadSeen(); await blocked; res.end('{"cloud_verified":true}'); }
      else res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    let finished = false;
    const running = runCounter(argsFor({ ...flags, api: `http://127.0.0.1:${address.port}` }), {}, (stderr) => {
      if (batchId && stderr.includes(`batch_id: ${batchId} (created;`)) receiptSeen();
    }).then((value) => { finished = true; return value; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([receipt, uploading]), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('No batch receipt before upload completed')), 15000);
      })]);
      expect(finished).toBe(false);
    } finally {
      clearTimeout(timer);
      releaseUpload();
      await running;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const result = await running;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).batch_id).toBe(batchId);
  });
});
