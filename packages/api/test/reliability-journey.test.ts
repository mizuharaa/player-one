import { createHash, randomUUID as uid } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApi, CURRENT_AGREEMENTS, EXAM_ANSWERS, hashCredential, signToken,
  fromDecimal, MONEY_SCALE, mul, quantise, type ObjectStore,
} from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
import { argsFor, fixture, flags, runCounter } from './counter-cli-helpers.ts';

useDatabase('journey');
const SECRET = 'reliability-journey-local-only';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Bounded integration proof using the tracked counter fixture. Its MP4s are
// synthetic headers, not playable footage; this does not prove device capture.
describe.skipIf(!hasDb())('collector to income across retry boundaries', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it.each(['duplicate import', 'lost accepted import response', 'corrupt readback'] as const)(
    '%s preserves one reviewed earning through billing and collector visibility', async (fault) => {
      const d = await db();
      const [database] = await d.execute(sql`select current_database() as name`);
      console.info(`journey database: ${database!.name}`);
      const ids = {
        centre: uid(), machine: uid(), operator: uid(), collector: uid(), task: uid(),
        deviceType: uid(), device: uid(), scenario: uid(),
        otherCentre: uid(), otherMachine: uid(), otherOperator: uid(), otherCollector: uid(),
        otherDevice: uid(), otherTask: uid(), otherHandover: uid(), otherSession: uid(),
      };
      const hash = await hashCredential('pw');
      // Reference/enrolment fixtures only. Claims, sessions, measurements,
      // verification, verdicts, settlements and bills are written by real routes.
      await d.execute(sql`insert into upload_centres (id, region, name, status) values
        (${ids.centre}, 'HCM', 'journey', 'active'), (${ids.otherCentre}, 'HN', 'other', 'active')`);
      await d.execute(sql`insert into upload_devices
        (id, upload_centre_id, machine_identifier, status, credential_hash) values
        (${ids.machine}, ${ids.centre}, 'HCM-01', 'active', ${hash}),
        (${ids.otherMachine}, ${ids.otherCentre}, 'HN-02', 'active', ${hash})`);
      await d.execute(sql`insert into operators
        (id, upload_centre_id, external_ref, role, credential_hash) values
        (${ids.operator}, ${ids.centre}, 'op-1', 'centre_operator', ${hash}),
        (${ids.otherOperator}, ${ids.otherCentre}, 'op-2', 'centre_operator', ${hash})`);
      await d.execute(sql`insert into collectors (id, external_ref, status) values
        (${ids.collector}, 'journey-collector', 'qualified'),
        (${ids.otherCollector}, 'other-collector', 'qualified')`);
      await d.execute(sql`insert into device_types (id, code, generation)
        values (${ids.deviceType}, 'ego_headset', 'gen1')`);
      await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values
        (${ids.device}, ${ids.deviceType}, 'SYNTH0000001', 'active'),
        (${ids.otherDevice}, ${ids.deviceType}, 'SYNTH0000002', 'active')`);
      await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values
        (${ids.task}, 'journey task', 1200, 5, 'published'),
        (${ids.otherTask}, 'other task', 900, 5, 'published')`);
      await d.execute(sql`insert into scenarios (id, code, privacy_risk_level)
        values (${ids.scenario}, 'home', 'low')`);

      const temp = await mkdtemp(join(tmpdir(), 'po-reliability-journey-'));
      const mediaRoot = join(temp, 'media');
      const objects = join(temp, 'objects');
      const metadata = new Map<string, string>();
      const writes: { key: string; force: boolean }[] = [];
      const reads: string[] = [];
      let corrupt = fault === 'corrupt readback';
      let damagedKey: string | undefined;
      const pathOf = (key: string) => join(objects, key.replaceAll('/', '__'));
      const objectStore: ObjectStore = {
        async put(key, localPath, digest, force = false) {
          const stored = await stat(pathOf(key)).catch(() => null);
          if (!force && metadata.get(key) === digest && stored?.size === (await stat(localPath)).size) {
            return 'kept';
          }
          await mkdir(objects, { recursive: true });
          await copyFile(localPath, pathOf(key));
          metadata.set(key, digest);
          writes.push({ key, force });
          // Same size and honest-looking metadata, different bytes. The only
          // way to catch this is to read and hash the object body.
          const bytes = await readFile(pathOf(key));
          if (corrupt && bytes.length > 0 && damagedKey === undefined) {
            damagedKey = key;
            bytes[0] = bytes[0]! ^ 0xff;
            await writeFile(pathOf(key), bytes);
          }
          return 'uploaded';
        },
        async read(key, from = 0) {
          reads.push(key);
          return metadata.has(key) ? createReadStream(pathOf(key), { start: from }) : null;
        },
        async tag() {},
      };
      const noGateway = async (): Promise<never> => { throw new Error('journey must not call a gateway'); };
      const app = buildApi({
        db: await appDb(), tokenSecret: SECRET, mediaRoot, objectStore, verificationGate: 'cloud',
        sendSignInCode: noGateway,
        payout: { mode: 'manual', client: {
          verifyAccount: noGateway, transferFund: noGateway, queryTransaction: noGateway,
          balance: noGateway, bankCodes: noGateway,
        } },
      });
      let losePath: string | undefined;
      let loseImport = false;
      const dropped: { url: string; status: number; body: string }[] = [];
      app.addHook('onRequest', async (request) => {
        if (loseImport && /^\/upload-batches\/[^/]+\/episodes$/.test(request.url)) {
          loseImport = false;
          losePath = request.url;
        }
      });
      // onSend runs after the route's awaited transaction has completed.
      // Destroy the actual HTTP socket before any response reaches the client.
      app.addHook('onSend', async (request, reply, payload) => {
        if (request.url === losePath) {
          losePath = undefined;
          dropped.push({ url: request.url, status: reply.statusCode, body: String(payload) });
          reply.hijack();
          reply.raw.destroy();
        }
        return payload;
      });
      try {
        const sessionDir = join(mediaRoot, basename(fixture));
        await cp(fixture, sessionDir, { recursive: true });
        const api = await app.listen({ host: '127.0.0.1', port: 0 });
        type Headers = Record<string, string>;
        const request = (method: string, path: string, body?: unknown, headers: Headers = {}) =>
          fetch(`${api}${path}`, {
            method, headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
          });
        const json = async (method: string, path: string, body?: unknown, headers: Headers = {}, status = 200) => {
          const response = await request(method, path, body, headers);
          const raw = await response.text();
          expect(response.status, `${path}: ${raw}`).toBe(status);
          return JSON.parse(raw);
        };
        const who = (collectorId: string): Headers => ({
          authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId, epoch: 1 })}`,
        });
        const me = who(ids.collector);
        const other = who(ids.otherCollector);
        const login = async (machine: string, operator: string): Promise<Headers> => ({
          'x-machine-token': `Bearer ${(await json('POST', '/auth/machine', { machine_identifier: machine, secret: 'pw' })).token}`,
          authorization: `Bearer ${(await json('POST', '/auth/operator', { external_ref: operator, secret: 'pw' })).token}`,
        });
        const counter = await login('HCM-01', 'op-1');
        const otherCounter = await login('HN-02', 'op-2');
        const claimId = uid();
        for (const [headers, taskId, claim] of [[me, ids.task, claimId], [other, ids.otherTask, uid()]] as const) {
          await json('POST', '/api/me/register', { name: 'Journey collector' }, headers, 201);
          await json('POST', '/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] }, headers);
          await json('POST', '/api/me/training', undefined, headers);
          expect((await json('POST', '/api/me/exam', { answers: [...EXAM_ANSWERS] }, headers)).passed).toBe(true);
          await json('POST', `/api/me/tasks/${taskId}/claims`, { id: claim }, headers, 201);
        }
        await json('POST', '/api/me/devices', { hardware_serial: 'SYNTH0000001' }, me, 201);
        const appSessionId = uid();
        const appSession = {
          id: appSessionId, task_id: ids.task, device_serial: 'SYNTH0000001', scenario: 'home',
          others_in_frame: true, sensitive_info_present: false,
        };
        losePath = '/api/me/sessions';
        await expect(request('POST', losePath, appSession, me)).rejects.toThrow();
        expect(dropped.at(-1)?.status).toBe(201);
        expect(await json('POST', '/api/me/sessions', appSession, me)).toMatchObject({ id: appSessionId, replayed: true });
        expect(await d.execute(sql`select id from collection_sessions where id = ${appSessionId}`)).toHaveLength(1);

        // An actual competing card/session at a different centre and price.
        await json('POST', '/handovers', {
          id: ids.otherHandover, collector_id: ids.otherCollector, device_id: ids.otherDevice,
          tf_card_id: 'OTHER-CARD', handover_time: new Date().toISOString(),
        }, otherCounter, 201);
        await json('POST', `/handovers/${ids.otherHandover}/sessions`, {
          id: ids.otherSession, task_id: ids.otherTask, scenario_id: ids.scenario,
          others_in_frame: false, sensitive_info_present: false, prepare_time: '2026-08-13T09:08:00.000Z',
        }, otherCounter, 201);

        const cli = () => runCounter(argsFor({
          ...flags, api, 'session-dir': sessionDir, collector: ids.collector, device: ids.device,
          task: ids.task, scenario: ids.scenario, 'prepare-time': '2026-08-13T09:08:00.000Z',
        }), { PLAYERONE_MEDIA_ROOT: mediaRoot });
        // The batch id is created inside the CLI, so arm the failure as the
        // episode request arrives, before the onSend hook above discards it.
        loseImport = fault === 'lost accepted import response';
        const first = await cli();
        const initial = JSON.parse(first.stdout);
        expect(first.code, first.stderr).toBe(fault === 'duplicate import' ? 0 : 1);
        expect(initial.failed_step).toBe(fault === 'duplicate import' ? null : fault === 'corrupt readback' ? 'upload' : 'episodes');
        const episodeId = initial.episode_id as string;
        expect(episodeId).toEqual(expect.any(String));
        const beforeReview = await json('GET', '/api/me/income', undefined, me);
        expect(beforeReview.episodes).toEqual([expect.objectContaining({ episode_id: episodeId, amount: null, confirmed: false })]);
        expect(beforeReview.periods).toEqual([]);
        expect((await json('GET', '/api/me/income', undefined, other)).episodes).toEqual([]);

        let imported = initial;
        if (fault !== 'duplicate import') {
          expect((await request('POST', '/api/review/claim?queue=privacy', undefined, counter)).status).toBe(204);
          expect((await request('POST', `/upload-batches/${initial.batch_id}/cache-clean`, undefined, counter)).status).toBe(409);
          expect(await d.execute(sql`select id from settlements`)).toHaveLength(0);
        }
        if (fault === 'corrupt readback') {
          expect(damagedKey).toBeDefined();
          expect(reads).toContain(damagedKey);
          expect(sha(await readFile(pathOf(damagedKey!)))).not.toBe(metadata.get(damagedKey!));
          const [failed] = await d.execute(sql`select verification_state from episodes where episode_id = ${episodeId}`);
          expect(failed!.verification_state).toBe('failed');
          corrupt = false;
          const repaired = await json('POST', `/upload-batches/${initial.batch_id}/upload`, undefined, counter);
          expect(repaired.cloud_verified).toBe(true);
          expect(writes.some((w) => w.key === damagedKey && w.force)).toBe(true);
          expect(sha(await readFile(pathOf(damagedKey!)))).toBe(metadata.get(damagedKey!));
        } else {
          if (fault === 'lost accepted import response') {
            expect(dropped.at(-1)).toMatchObject({ url: `/upload-batches/${initial.batch_id}/episodes`, status: 200 });
            expect(JSON.parse(dropped.at(-1)!.body).episodes[0].episode_id).toBe(episodeId);
          }
          const writeCount = writes.length;
          const again = await cli();
          expect(again.code, again.stderr).toBe(0);
          imported = JSON.parse(again.stdout);
          expect(imported).toMatchObject({ episode_id: episodeId, cloud_verified: true, failed_step: null });
          // CLI reruns use new envelope IDs; the stored delivery stays unique.
          expect(imported.batch_id).not.toBe(initial.batch_id);
          expect(imported.session_id).not.toBe(initial.session_id);
          if (fault === 'duplicate import') expect(writes).toHaveLength(writeCount);
        }
        expect(await d.execute(sql`select ingest_id from episode_ingests where episode_id = ${episodeId}`)).toHaveLength(1);
        const links = await d.execute(sql`
          select e.episode_id, e.upload_batch_id, e.collection_session_id, e.verification_state,
                 cs.collector_id, cs.task_id, cs.task_claim_id, h.tf_card_id, h.upload_centre_id
            from episodes e join collection_sessions cs on cs.id = e.collection_session_id
            join handovers h on h.id = cs.handover_id where e.episode_id = ${episodeId}`);
        expect(links).toEqual([expect.objectContaining({
          episode_id: episodeId, upload_batch_id: imported.batch_id, collection_session_id: imported.session_id,
          verification_state: 'verified', collector_id: ids.collector, task_id: ids.task,
          task_claim_id: claimId, tf_card_id: flags.card, upload_centre_id: ids.centre,
        })]);
        expect((await request('POST', '/api/review/claim', undefined, counter)).status).toBe(204);
        const review = await json('POST', '/api/review/claim?queue=privacy', undefined, counter);
        expect(review).toMatchObject({ episode_id: episodeId, queue: 'privacy' });
        expect(Number(review.measured_duration_seconds)).toBeGreaterThan(0);
        const verdict = { verdict_id: uid(), episode_id: episodeId, decision: 'good', time_to_verdict_seconds: 31 };
        losePath = '/api/review/verdict';
        await expect(request('POST', losePath, verdict, counter)).rejects.toThrow();
        expect(dropped.at(-1)?.status, dropped.at(-1)?.body).toBe(200);
        const accepted = JSON.parse(dropped.at(-1)!.body);
        expect(accepted.replayed).toBe(false);
        const replay = await json('POST', '/api/review/verdict', verdict, counter);
        expect(replay).toMatchObject({ replayed: true, amount: accepted.amount, effective_minutes: accepted.effective_minutes });
        expect(quantise(mul(fromDecimal('1200.0000'), fromDecimal(accepted.effective_minutes)), MONEY_SCALE)).toBe(accepted.amount);
        expect(Number(accepted.amount)).toBeGreaterThan(0);
        const approved = await json('GET', '/api/me/income', undefined, me);
        expect(approved.episodes).toEqual([expect.objectContaining({ episode_id: episodeId, confirmed: true, amount: accepted.amount })]);
        expect(approved.not_yet_billed).toMatchObject({ episodes: 1, amount: accepted.amount });
        const now = Date.now();
        const period = { period_start: new Date(now - 86_400_000).toISOString(), period_end: new Date(now + 86_400_000).toISOString() };
        losePath = '/api/settle/bills';
        await expect(request('POST', losePath, period, counter)).rejects.toThrow();
        expect(dropped.at(-1)?.status, dropped.at(-1)?.body).toBe(200);
        const billed = JSON.parse(dropped.at(-1)!.body);
        expect(billed.created).toBe(1);
        expect(billed.bills).toEqual([expect.objectContaining({ collector_ref: 'journey-collector', total: accepted.amount })]);
        expect((await json('POST', '/api/settle/bills', period, counter)).created).toBe(0);
        const [counts] = await d.execute(sql`select
          (select count(*)::int from episodes) as episodes,
          (select count(*)::int from episode_reviews) as reviews,
          (select count(*)::int from settlements) as settlements,
          (select count(*)::int from bills) as bills,
          (select count(*)::int from bill_lines) as lines,
          (select count(*)::int from payout_attempts) as payouts`);
        expect(counts).toEqual({ episodes: 1, reviews: 1, settlements: 1, bills: 1, lines: 1, payouts: 0 });
        const ledger = await d.execute(sql`
          select r.episode_id, s.task_claim_id, s.amount::text, b.total::text, b.collector_id,
                 (s.amount = s.unit_price * s.effective_minutes) as reproducible
            from bill_lines bl join bills b on b.id = bl.bill_id
            join settlements s on s.id = bl.settlement_id join episode_reviews r on r.id = s.episode_review_id`);
        expect(ledger).toEqual([expect.objectContaining({
          episode_id: episodeId, task_claim_id: claimId, amount: accepted.amount,
          total: accepted.amount, collector_id: ids.collector, reproducible: true,
        })]);
        const income = await json('GET', '/api/me/income', undefined, me);
        expect(income.episodes).toEqual([expect.objectContaining({
          episode_id: episodeId, amount: accepted.amount, confirmed: true, paid_at: null,
        })]);
        expect(income.episodes[0].state).not.toBe('paid');
        expect(income.not_yet_billed).toMatchObject({ episodes: 0, amount: '0.0000' });
        expect(income.periods).toEqual([expect.objectContaining({ episodes: 1, amount: accepted.amount })]);
        const otherIncome = await json('GET', '/api/me/income', undefined, other);
        expect(otherIncome.episodes).toEqual([]);
        expect(otherIncome.periods).toEqual([]);
        const task = await json('GET', `/api/me/tasks/${ids.task}`, undefined, me);
        // Task progress is stored payable minutes converted back to seconds;
        // it intentionally includes the six-decimal minute quantisation.
        expect(Number(task.collected_effective_s)).toBe(Number(
          quantise(mul(fromDecimal(accepted.effective_minutes), fromDecimal('60')), 6),
        ));
        const sessions = (await json('GET', '/api/me/sessions', undefined, me)).sessions;
        expect(sessions.map((s: { id: string }) => s.id)).toContain(appSessionId);
        expect(sessions.map((s: { id: string }) => s.id)).toContain(imported.session_id);
        expect(sessions.map((s: { id: string }) => s.id)).not.toContain(ids.otherSession);
        if (fault === 'duplicate import') {
          const writeCount = writes.length;
          const afterBill = await cli();
          expect(afterBill.code, afterBill.stderr).toBe(0);
          expect(JSON.parse(afterBill.stdout)).toMatchObject({ episode_id: episodeId, cloud_verified: true });
          expect(writes).toHaveLength(writeCount);
          expect(await json('GET', '/api/me/income', undefined, me)).toEqual(income);
          expect((await json('POST', '/api/review/verdict', verdict, counter)).replayed).toBe(true);
          expect((await json('POST', '/api/settle/bills', period, counter)).created).toBe(0);
          expect(await d.execute(sql`select id from settlements`)).toHaveLength(1);
          expect(await d.execute(sql`select ingest_id from episode_ingests`)).toHaveLength(1);
        }
        // Cloud verification never authorizes this test to delete TF source bytes.
        expect(await readFile(join(sessionDir, `meta_${basename(fixture)}.json`))).toEqual(
          await readFile(join(fixture, `meta_${basename(fixture)}.json`)),
        );
      } finally {
        await app.close();
        await rm(temp, { recursive: true, force: true });
      }
    },
  );
});
