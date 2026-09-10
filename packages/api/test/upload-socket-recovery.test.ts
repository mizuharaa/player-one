import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PART_SIZE } from '../src/upload-worker.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

/** A local S3 protocol fixture, not proof of GreenNode's implementation. It
 * keeps actual uploaded bytes across fresh worker processes and can lose the
 * completion response after storing them, just as a broken socket can. */
async function fixture() {
  const parts = new Map<number, Buffer>();
  const uploads: number[] = [];
  const reads: number[] = [];
  let object: Buffer | undefined;
  let digest = '';
  let open = false;
  let failTail = true;
  let loseCompletion = true;
  let cutRead = true;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost');
      const xml = (body: string, code = 200) => {
        res.writeHead(code, { 'content-type': 'application/xml' });
        res.end(body);
      };
      if (req.method === 'HEAD') {
        if (!object) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-length': object.length, 'x-amz-meta-sha256': digest });
        res.end();
      } else if (req.method === 'GET' && url.searchParams.has('uploads')) {
        xml(`<ListMultipartUploadsResult>${open ? '<Upload><Key>episodes/recovery/ingest/camera.mp4</Key><UploadId>upload-1</UploadId><Initiated>2026-09-09T00:00:00Z</Initiated></Upload>' : ''}</ListMultipartUploadsResult>`);
      } else if (req.method === 'GET' && url.searchParams.has('uploadId')) {
        if (!open) { xml('<Error><Code>NoSuchUpload</Code></Error>', 404); return; }
        xml(`<ListPartsResult>${[...parts].map(([n, b]) => `<Part><PartNumber>${n}</PartNumber><ETag>part-${n}</ETag><Size>${b.length}</Size></Part>`).join('')}</ListPartsResult>`);
      } else if (req.method === 'POST' && url.searchParams.has('uploads')) {
        open = true;
        digest = String(req.headers['x-amz-meta-sha256']);
        xml('<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>');
      } else if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
        const n = Number(url.searchParams.get('partNumber'));
        uploads.push(n);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        if (n === 2 && failTail) { req.socket.destroy(); return; }
        parts.set(n, Buffer.concat(chunks));
        res.writeHead(200, { etag: `part-${n}` });
        res.end();
      } else if (req.method === 'POST' && url.searchParams.has('uploadId')) {
        for await (const _chunk of req) { /* consume the completion XML */ }
        if (!open) { xml('<Error><Code>NoSuchUpload</Code></Error>', 404); return; }
        object = Buffer.concat([...parts].sort(([a], [b]) => a - b).map(([, b]) => b));
        open = false;
        if (loseCompletion) { loseCompletion = false; req.socket.destroy(); return; }
        xml('<CompleteMultipartUploadResult><ETag>complete</ETag></CompleteMultipartUploadResult>');
      } else if (req.method === 'GET' && object) {
        const from = Number(String(req.headers.range ?? '').match(/^bytes=(\d+)-$/)?.[1] ?? 0);
        reads.push(from);
        res.writeHead(from ? 206 : 200, {
          'content-length': object.length - from,
          ...(from ? { 'content-range': `bytes ${from}-${object.length - 1}/${object.length}` } : {}),
        });
        if (cutRead) {
          cutRead = false;
          res.write(object.subarray(from, from + 4096), () => setTimeout(() => res.destroy(), 30));
        } else res.end(object.subarray(from));
      } else xml('<Error><Code>UnexpectedRequest</Code></Error>', 400);
    } catch (error) {
      res.destroy(error as Error);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });
  const port = (server.address() as { port: number }).port;
  const root = await mkdtemp(join(tmpdir(), 'po-upload-socket-'));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'source'));
  const source = Buffer.alloc(PART_SIZE + 31, 0x6b);
  source.write('a different tail', PART_SIZE);
  const sourcePath = join(root, 'source', 'camera.mp4');
  await writeFile(sourcePath, source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const config = { endpoint: `http://127.0.0.1:${port}`, bucket: 'test', key: 'local-test', secret: 'local-test' };
  const args = { episodeId: 'recovery', ingestId: 'ingest', mediaRoot: root,
    sourceBasename: 'source', sourceFiles: [{ relative_path: 'camera.mp4', sha256 }], force: false };
  const workerUrl = new URL('../src/upload-worker.ts', import.meta.url).href;

  const run = () => new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { S3ObjectStore, uploadEpisode } from ${JSON.stringify(workerUrl)};
      try { console.log(JSON.stringify(await uploadEpisode(new S3ObjectStore(${JSON.stringify(config)}), ${JSON.stringify(args)}))); }
      catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
    `], {
      env: { ...process.env, DATABASE_URL: '', AWS_MAX_ATTEMPTS: '1',
        AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), 25_000);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!stdout) reject(new Error(`worker exited ${code}: ${stderr}`));
      else resolve({ code, stdout });
    });
  });
  return { run, parts, uploads, reads, sha256, sourcePath,
    allowTail: () => { failTail = false; }, stored: () => object };
}

it('UPL-04/05/16: process restart resumes held parts, survives a lost completion ack, and hashes a ranged read-back', async () => {
  const f = await fixture();
  const first = await f.run();
  expect(first.code, first.stdout).toBe(1);
  expect(f.uploads).toEqual([1, 2, 2, 2]);
  expect([...f.parts.keys()]).toEqual([1]);
  expect(f.stored()).toBeUndefined();
  expect(f.reads).toEqual([]);

  f.allowTail();
  const second = await f.run();
  expect(second.code, second.stdout).toBe(1); // Stored, but its acknowledgement was lost.
  expect(f.uploads).toEqual([1, 2, 2, 2, 2]);
  expect(createHash('sha256').update(f.stored()!).digest('hex')).toBe(f.sha256);

  const third = await f.run();
  expect(third.code, third.stdout).toBe(0);
  expect(JSON.parse(third.stdout)).toEqual({ uploaded: 0, kept: 1, transported: 1, mismatches: [] });
  expect(f.uploads).toEqual([1, 2, 2, 2, 2]); // No part re-sent after completion.
  expect(f.reads).toEqual([0, 4096]);
  expect(createHash('sha256').update(await readFile(f.sourcePath)).digest('hex')).toBe(f.sha256);
}, 90_000);
