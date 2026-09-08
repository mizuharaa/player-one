import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EpisodeRecord } from '@playerone/contracts';
import { buildImportBodies, parseImportArgs } from '../bin/counter.ts';
import { HandoverBody, SessionBody, BatchBody } from '../src/counter.ts';
import { argsFor, credentials, fixture, flags, runCounter } from './counter-cli-helpers.ts';

function summary(result: Awaited<ReturnType<typeof runCounter>>) {
  expect(result.stdout.endsWith('\n')).toBe(true);
  const lines = result.stdout.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  const value = JSON.parse(lines[0]!);
  expect(Object.keys(value).sort()).toEqual([
    'handover_id', 'session_id', 'batch_id', 'episode_id', 'ingest_state',
    'cloud_verified', 'elapsed_s', 'failed_step',
  ].sort());
  expect(value.elapsed_s).toBeGreaterThanOrEqual(0);
  return value;
}

describe('counter import arguments and request schemas (no database)', () => {
  it.each(Object.keys(flags))('missing --%s exits 2 and names the flag', async (flag) => {
    const values: Record<string, string> = { ...flags };
    delete values[flag];
    const result = await runCounter(argsFor(values));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`--${flag} is required`);
    expect(summary(result)).toMatchObject({
      failed_step: 'usage', handover_id: null, batch_id: null, session_id: null,
      episode_id: null, ingest_state: null, cloud_verified: null,
    });
  });

  it.each(['others-in-frame', 'sensitive'])('requires yes|no for --%s', async (flag) => {
    const result = await runCounter(argsFor({ ...flags, [flag]: 'false' }));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`--${flag} must be yes|no`);
    expect(summary(result).failed_step).toBe('usage');
    for (const value of ['yes', 'no']) {
      const parsed = parseImportArgs(argsFor({ ...flags, [flag]: value }));
      expect(flag === 'sensitive' ? parsed.sensitive : parsed.othersInFrame).toBe(value === 'yes');
    }
  });

  it.each([
    ['collector', 'invalid'], ['device', 'invalid'], ['task', 'invalid'], ['scenario', 'invalid'],
    ['prepare-time', 'yesterday'], ['prepare-time', '2026-08-13T09:08:00+99:99'],
    ['api', 'ftp://localhost'], ['api', ''],
  ])('malformed --%s=%s exits 2', async (flag, value) => {
    const result = await runCounter(argsFor({ ...flags, [flag]: value }));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`--${flag}`);
    expect(summary(result).failed_step).toBe('usage');
  });

  it.each([[], ['other'], [...argsFor(), '--unknown'], [...argsFor(), '--api']].map((args) => ({ args })))(
    'refuses malformed command arguments $args', async ({ args }) => {
      const result = await runCounter(args);
      expect(result.code).toBe(2);
      expect(summary(result).failed_step).toBe('usage');
      expect(result.stderr).toContain('Usage:');
      expect(result.stderr).toContain('verified by this command');
    },
  );

  it.each(Object.keys(credentials))('requires nonempty %s', async (name) => {
    for (const value of [undefined, '']) {
      const result = await runCounter(argsFor(), { [name]: value });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(`${name} is required`);
      expect(summary(result).failed_step).toBe('credentials');
    }
  });

  it('defaults the API and prepare time and builds bodies accepted by the real schemas', () => {
    const before = Date.now();
    const options = parseImportArgs(argsFor());
    expect(options.api).toBe('http://127.0.0.1:8080');
    expect(Date.parse(options.prepareTime)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(options.prepareTime)).toBeLessThanOrEqual(Date.now());
    const bodies = buildImportBodies(options);
    expect(HandoverBody.parse(bodies.handover)).toEqual(bodies.handover);
    expect(BatchBody.parse(bodies.batch)).toEqual(bodies.batch);
    expect(SessionBody.parse(bodies.session)).toEqual(bodies.session);
    expect(bodies.batch.handover_id).toBe(bodies.handover.id);
    expect(new Set([bodies.handover.id, bodies.batch.id, bodies.session.id]).size).toBe(3);
    const explicit = parseImportArgs(argsFor({ ...flags, 'prepare-time': '2026-08-13T09:08:00+07:00' }));
    expect(SessionBody.parse(buildImportBodies(explicit).session).prepare_time).toBe('2026-08-13T02:08:00.000Z');
  });

  it.each([join(fixture, 'missing-directory'), join(fixture, 'meta_ego_SYNTH0000001_20260813_090800.json')])(
    'refuses a missing directory or a file: %s', async (sessionDir) => {
      const result = await runCounter(argsFor({ ...flags, 'session-dir': sessionDir }));
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--session-dir');
      expect(summary(result).failed_step).toBe('session-dir');
    },
  );

  it('refuses a parent outside the local media root and qualifies what the check proves', async () => {
    const result = await runCounter(argsFor(), { PLAYERONE_MEDIA_ROOT: dirname(dirname(fixture)) });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--session-dir parent must be PLAYERONE_MEDIA_ROOT');
    expect(result.stderr).toContain('local sanity check only');
    expect(result.stderr).toContain('server-side media availability is not verified by this command');
    expect(summary(result).failed_step).toBe('session-dir');
  });
});

const listen = (server: Server) => new Promise<string>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('No TCP address'));
    resolve(`http://127.0.0.1:${address.port}`);
  });
});
const close = (server: Server) => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

describe('counter import output over HTTP (no database)', () => {
  it.each(['verified', 'unverified', 'session-error', 'connection-refused', 'ingest-error'])(
    '%s preserves exit code, streams and failed step', async (mode) => {
      const requests: { method?: string; path?: string; headers: IncomingHttpHeaders; body: any }[] = [];
      const uploadBody = JSON.stringify({ cloud_verified: mode === 'verified', episodes: [
        { verification_state: mode === 'verified' ? 'verified' : 'failed', mismatches: ['keep this detail'] },
      ] }, null, 2);
      const refusal = '{\n  "error": "refused", "detail": "session claim missing"\n}\n';
      const submission = '{"episodes":[{"outcome":"new","resolution_state":"resolved"}]}';
      const server = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/auth/machine') res.end('{"token":"machine"}');
        else if (req.url === '/auth/operator') res.end('{"token":"operator"}');
        else if (req.url?.endsWith('/sessions') && mode === 'session-error') {
          res.statusCode = 409;
          res.end(refusal);
        } else if (req.url?.endsWith('/episodes')) res.end(submission);
        else if (req.url?.endsWith('/upload')) res.end(uploadBody);
        else { res.statusCode = 201; res.end('{}'); }
      });
      const api = await listen(server);
      let temp: string | undefined;
      try {
        if (mode === 'connection-refused') await close(server);
        if (mode === 'ingest-error') {
          temp = await mkdtemp(join(tmpdir(), 'po-counter-invalid-'));
          await mkdir(join(temp, 'nested-session'));
        }
        const result = await runCounter(argsFor({ ...flags, api, 'session-dir': temp ?? fixture }), {
          PLAYERONE_MEDIA_ROOT: mode === 'verified' ? dirname(fixture) : '',
        });
        const output = summary(result);
        expect(result.code).toBe(mode === 'verified' ? 0 : 1);
        if (mode === 'connection-refused') {
          expect(output).toMatchObject({ failed_step: 'auth/machine', handover_id: null, session_id: null,
            batch_id: null, episode_id: null, ingest_state: null, cloud_verified: null });
          expect(result.stderr).toContain('ECONNREFUSED');
          expect(result.stderr).toContain('failed_step: auth/machine');
          expect(requests).toHaveLength(0);
          return;
        }
        const paths = ['/auth/machine', '/auth/operator', '/handovers', '/upload-batches',
          `/handovers/${output.handover_id}/sessions`];
        if (mode === 'verified' || mode === 'unverified') paths.push(
          `/upload-batches/${output.batch_id}/episodes`, `/upload-batches/${output.batch_id}/upload`,
        );
        expect(requests.map((r) => r.path)).toEqual(paths);
        expect(requests.every((r) => r.method === 'POST')).toBe(true);
        expect(requests[0]!.body).toEqual({ machine_identifier: 'HCM-01', secret: 'pw' });
        expect(requests[1]!.body).toEqual({ external_ref: 'op-1', secret: 'pw' });
        for (const request of requests.slice(2)) {
          expect(request.headers['x-machine-token']).toBe('Bearer machine');
          expect(request.headers.authorization).toBe('Bearer operator');
        }
        expect(HandoverBody.parse(requests[2]!.body).id).toBe(output.handover_id);
        expect(BatchBody.parse(requests[3]!.body)).toMatchObject({ id: output.batch_id, handover_id: output.handover_id });
        expect(SessionBody.parse(requests[4]!.body)).toMatchObject({ id: output.session_id,
          others_in_frame: true, sensitive_info_present: false });
        if (mode === 'session-error' || mode === 'ingest-error') {
          const step = mode === 'session-error' ? 'session' : 'ingest';
          expect(output).toMatchObject({ failed_step: step, episode_id: null, ingest_state: null, cloud_verified: null });
          expect(result.stderr).toContain(mode === 'session-error' ? `${refusal}failed_step: session` : 'Error');
          expect(result.stderr).toContain(`failed_step: ${step}`);
        } else {
          expect(Object.keys(requests[5]!.body)).toEqual(['episodes']);
          expect(requests[5]!.body.episodes).toHaveLength(1);
          const record = EpisodeRecord.parse(requests[5]!.body.episodes[0]);
          expect(output).toMatchObject({ episode_id: record.episode_id, ingest_state: record.state,
            cloud_verified: mode === 'verified', failed_step: mode === 'verified' ? null : 'upload' });
          expect(result.stderr).toContain(submission);
          expect(result.stderr).toContain(uploadBody);
          expect(requests[6]!.body).toBeNull();
          if (mode === 'unverified') expect(result.stderr).toContain(`${uploadBody}\nfailed_step: upload`);
        }
        expect(result.stderr).toContain(mode === 'verified' ? 'local sanity check only' : 'local sanity check skipped');
        expect(result.stderr).toContain('server-side media availability is not verified by this command');
      } finally {
        if (server.listening) await close(server);
        if (temp) await rm(temp, { recursive: true, force: true });
      }
    },
  );
});
