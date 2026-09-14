import { spawn } from 'node:child_process';
import { randomUUID as uid } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveEpisodeId } from '@playerone/contracts';
import {
  buildApi,
  fromDecimal,
  hashCredential,
  MONEY_SCALE,
  mul,
  quantise,
  type ObjectStore,
} from '../src/index.ts';
import { appDb, closeDb, db, hasDb, liveClaim, truncate, useDatabase } from '../../store/test/db.ts';
import { hasSession, session } from '../../ingest/test/sessions.ts';

useDatabase('card_intake');

/**
 * `scripts/card-intake.mjs` — the counter's one command — against real sample
 * sessions, the real routes and a real Postgres.
 *
 * Two things are measured here that the end-to-end smoke run found broken.
 *
 * The retry rule. P0-2's acceptance says "import and upload retried once with
 * no duplicate episode or bill", and the shape that hides a broken retry is a
 * fixture where the second run cannot collide: `counter.ts import` mints a
 * fresh handover, batch and session id every time, so a retry always looked
 * fine and always left a second batch and a second declared session behind.
 *
 * And one declared session per card per day. The session id used to include
 * the directory name, so three recordings off one card became three
 * handover-origin sessions on one handover and the resolver refused to choose
 * between them — every episode after the first quarantined and an operator had
 * to call `POST /episodes/:id/resolve` by hand. `three recordings` below is
 * that case, and it asserts the resolution METHOD and the session id, not just
 * that nothing threw.
 *
 * The corpus directory stands in for the mounted card: the command is given a
 * path OUTSIDE the API's media root, so it copies and checksums first, which
 * is the path an operator now takes. One run is given the copy instead, which
 * is the other branch. Nothing in here writes to the corpus, and the last test
 * measures that.
 *
 * The cloud is a Map of buffers: `uploadEpisode`'s verdict is a read-back of
 * real bytes and never a metadata claim, so a store that hands back exactly
 * what it was given is everything this file needs from one. `upload.test.ts`
 * owns the corruption and interruption paths.
 */
const FIRST = '072310';
/** Two more real recordings off the same card. Not 072415: it is the empty one. */
const MORE = ['072516', '072538'] as const;
const CARD = 'CARD-INTAKE-0001';
const PHONE = '+84900000042';
const DAY = '2026-09-14';
const NEXT_DAY = '2026-09-15';
/** Published, and deliberately NOT claimed by this collector. */
const UNCLAIMED_TASK = 'Một buổi làm việc';
const SCRIPT = fileURLToPath(new URL('../scripts/card-intake.mjs', import.meta.url));

type Table = Record<string, string>;
type Run = { code: number | null; stdout: string; stderr: string; table: Table };

/** The printed table, back as a record, so a row can be asserted by name. */
const parseTable = (stdout: string): Table =>
  Object.fromEntries(
    stdout
      .split('\n')
      .slice(2)
      .map((line) => line.match(/^(\S+)\s\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1]!, m[2]!.trim()]),
  );

/** Name to size for every file under a directory, so a write to it is visible. */
async function sizes(dir: string): Promise<Record<string, number>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = join(e.parentPath, e.name);
    out[full.slice(dir.length + 1).replaceAll('\\', '/')] = (await stat(full)).size;
  }
  return out;
}

describe.skipIf(!hasDb() || !hasSession(FIRST) || MORE.some((id) => !hasSession(id)))(
  'one-command card intake',
  () => {
    const ids = {
      centre: uid(), machine: uid(), operator: uid(), finance: uid(),
      collector: uid(), deviceType: uid(), device: uid(),
      task: uid(), otherTask: uid(), scenario: uid(),
    };
    const episodeId = deriveEpisodeId(basename(session(FIRST)));
    const objects = new Map<string, { sha256: string; bytes: Buffer }>();
    let app: FastifyInstance;
    let api: string;
    let inbox: string;
    let counter: Record<string, string>;
    let onCard: Record<string, number>;
    /** What the verdict said the footage was worth; the bill has to reproduce it. */
    let paid: { amount: string; effective_minutes: string };

    function intake(sessionDir: string, extra: string[] = []): Promise<Run> {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PLAYERONE_MACHINE_IDENTIFIER: 'CARD-01',
        PLAYERONE_MACHINE_SECRET: 'pw',
        PLAYERONE_OPERATOR_REF: 'card-op-1',
        PLAYERONE_OPERATOR_SECRET: 'pw',
        PLAYERONE_MEDIA_ROOT: inbox,
      };
      // The counter has to keep working with the link to the office down, so the
      // command must never reach for a database of its own.
      delete env.DATABASE_URL;
      const args = [
        SCRIPT, sessionDir,
        '--card', CARD,
        '--collector', PHONE,
        '--others-in-frame', 'yes',
        '--sensitive', 'no',
        '--day', DAY,
        '--api', api,
        ...extra,
      ];
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
        child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr, table: parseTable(stdout) }));
      });
    }

    /** Every row the retry could duplicate, counted in one round trip. */
    const counts = async (): Promise<Record<string, number>> => {
      const d = await db();
      const [row] = await d.execute(sql`
        select (select count(*) from episodes)::int as episodes,
               (select count(*) from episode_ingests)::int as ingests,
               (select count(*) from handovers)::int as handovers,
               (select count(*) from upload_batches)::int as batches,
               (select count(*) from collection_sessions)::int as sessions,
               (select count(*) from episode_reviews)::int as reviews,
               (select count(*) from settlements)::int as settlements,
               (select count(*) from bills)::int as bills,
               (select count(*) from bill_lines)::int as lines`);
      return row as unknown as Record<string, number>;
    };

    /** How every episode is attributed, straight off the table. */
    const attributions = async () => {
      const d = await db();
      return (await d.execute(sql`
        select episode_id, collection_session_id, resolution_state, resolution_method
          from episodes order by episode_id`)) as unknown as {
        episode_id: string;
        collection_session_id: string | null;
        resolution_state: string;
        resolution_method: string | null;
      }[];
    };

    beforeAll(async () => {
      await truncate();
      const d = await db();
      const hash = await hashCredential('pw');
      await d.execute(sql`insert into upload_centres (id, region, name, status)
        values (${ids.centre}, 'HCM', 'card intake centre', 'active')`);
      await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
        values (${ids.machine}, ${ids.centre}, 'CARD-01', 'active', ${hash})`);
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${ids.operator}, ${ids.centre}, 'card-op-1', 'centre_operator', ${hash})`);
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${ids.finance}, ${ids.centre}, 'card-fin-1', 'finance', ${hash})`);
      /**
       * The phone is seeded directly, for the reason `e2e-loop.mjs` records at
       * length: BO-03 enrols a collector by `external_ref` and no back-office
       * route carries a phone at all. The command resolves the number through
       * `GET /reference/sync`, which returns whole collector rows.
       */
      await d.execute(sql`insert into collectors (id, external_ref, status, phone)
        values (${ids.collector}, 'card-c-1', 'qualified', ${PHONE})`);
      await d.execute(sql`insert into device_types (id, code, generation)
        values (${ids.deviceType}, 'ego_headset', 'gen1')`);
      await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status, bound_collector_id, bound_at)
        values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active', ${ids.collector}, now())`);
      await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
        values (${ids.task}, 'housework', 1200.0000, 5, 'published')`);
      /**
       * A SECOND published task nobody here has claimed, which is the shape the
       * smoke run was refused on: the command defaulted `--task` to the first
       * published task and the demo collector's claim was the other one. With
       * one published task the bug is invisible.
       */
      await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
        values (${ids.otherTask}, ${UNCLAIMED_TASK}, 900.0000, 5, 'published')`);
      await d.execute(sql`insert into scenarios (id, code, privacy_risk_level)
        values (${ids.scenario}, 'home', 'low')`);
      await liveClaim(d, ids.task, ids.collector);

      inbox = await mkdtemp(join(tmpdir(), 'po-card-inbox-'));
      onCard = await sizes(session(FIRST));

      const objectStore: ObjectStore = {
        async put(key, localPath, sha256, force = false) {
          const held = objects.get(key);
          if (!force && held?.sha256 === sha256) return 'kept';
          objects.set(key, { sha256, bytes: await readFile(localPath) });
          return 'uploaded';
        },
        async read(key, from = 0) {
          const held = objects.get(key);
          return held === undefined ? null : Readable.from(held.bytes.subarray(from));
        },
        async tag() {},
      };
      app = buildApi({
        db: await appDb(),
        tokenSecret: 'card-intake-test',
        mediaRoot: inbox,
        objectStore,
      });
      api = await app.listen({ host: '127.0.0.1', port: 0 });
      const tok = async (url: string, payload: Record<string, string>): Promise<string> =>
        (await app.inject({ method: 'POST', url, payload })).json().token;
      counter = {
        'x-machine-token': `Bearer ${await tok('/auth/machine', { machine_identifier: 'CARD-01', secret: 'pw' })}`,
        authorization: `Bearer ${await tok('/auth/operator', { external_ref: 'card-op-1', secret: 'pw' })}`,
      };
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      await closeDb();
      if (inbox !== undefined) await rm(inbox, { recursive: true, force: true });
    });

    it('copies the card, matches every checksum, and lands one verified episode', async () => {
      const run = await intake(session(FIRST));
      expect(run.code, run.stderr).toBe(0);
      expect(run.table).toMatchObject({
        session: basename(session(FIRST)),
        episode: episodeId,
        ingest: 'new',
        verification: 'verified',
      });
      expect(run.table.copy).toMatch(/^\d+ files, sha256 matched$/);
      // One declared session on the handover, so the resolver needs no human.
      expect(run.table.attribution).toMatch(/^automatic_single -> session [0-9a-f-]{36} \(resolved\)$/);
      expect(run.table.reuse).toBe('handover opened, batch opened, session opened');
      expect(await counts()).toMatchObject({
        episodes: 1, ingests: 1, handovers: 1, batches: 1, sessions: 1,
      });
      expect(objects.size).toBeGreaterThan(0);
    }, 600_000);

    it('prints duplicate on a second run and counts nothing twice', async () => {
      const before = await counts();
      const run = await intake(session(FIRST));
      expect(run.code, run.stderr).toBe(0);
      expect(run.table).toMatchObject({ episode: episodeId, ingest: 'duplicate', verification: 'verified' });
      expect(run.table.reuse).toBe('handover reused, batch reused, session reused');
      expect(await counts()).toEqual(before);
    }, 600_000);

    it('puts three recordings off one card on ONE session, each resolved automatically', async () => {
      for (const id of MORE) {
        const run = await intake(session(id));
        expect(run.code, run.stderr).toBe(0);
        expect(run.table).toMatchObject({ ingest: 'new', verification: 'verified' });
        expect(run.table.reuse).toBe('handover reused, batch reused, session reused');
      }
      expect(await counts()).toMatchObject({
        episodes: 3, ingests: 3, handovers: 1, batches: 1, sessions: 1,
      });
      /**
       * The finding this replaces, asserted where it actually lives. Three
       * declared sessions on one handover made the resolver refuse to choose
       * and every episode after the first came back quarantined with a null
       * session, which an operator then had to resolve by hand.
       */
      const rows = await attributions();
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.resolution_state, row.episode_id).toBe('resolved');
        expect(row.resolution_method, row.episode_id).toBe('automatic_single');
      }
      expect(new Set(rows.map((r) => r.collection_session_id)).size).toBe(1);
      expect(rows[0]!.collection_session_id).not.toBeNull();
    }, 900_000);

    it('opens a second handover, batch and session on the next day', async () => {
      const run = await intake(join(inbox, basename(session(FIRST))), ['--day', NEXT_DAY]);
      expect(run.code, run.stderr).toBe(0);
      expect(run.table.reuse).toBe('handover opened, batch opened, session opened');
      // A shift is a day, so the day is part of all three derived ids.
      expect(await counts()).toMatchObject({
        episodes: 3, ingests: 3, handovers: 2, batches: 2, sessions: 2,
      });
    }, 600_000);

    it('names the collector live claims when the task is not one of them', async () => {
      const before = await counts();
      const run = await intake(join(inbox, basename(session(FIRST))), ['--task', UNCLAIMED_TASK]);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain('session_claim_missing');
      expect(run.stderr).toContain('--task "housework"');
      expect(run.stderr).toContain(ids.task);
      expect(run.stderr).toContain('failed_step: session');
      // Refused before anything was written, so nothing moved.
      expect(await counts()).toEqual(before);
    }, 300_000);

    it('turns one verdict into one bill line whose minutes reproduce its amount', async () => {
      const claimed = await app.inject({
        method: 'POST', url: '/api/review/claim?queue=privacy', headers: counter,
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      const reviewing: string = claimed.json().episode_id;

      const verdict = await app.inject({
        method: 'POST', url: '/api/review/verdict', headers: counter,
        payload: {
          verdict_id: uid(),
          episode_id: reviewing,
          decision: 'partial',
          // Seventeen seconds: a figure whose fractional dong is large enough
          // that the amount cannot come out right by accident (CLAUDE.md).
          spans: [{ start_seconds: 0, end_seconds: 17 }],
          time_to_verdict_seconds: 31.25,
        },
      });
      expect(verdict.statusCode, verdict.body).toBe(200);
      paid = verdict.json();
      /**
       * The identity an auditor checks first, asserted with the service's own
       * single rounding site rather than with arithmetic of this file's own:
       * `unit_price x effective_minutes` must reproduce `amount` exactly. The
       * amount comes from the ROUNDED minutes and CLAUDE.md says not to "fix"
       * that, so a figure computed here from the exact seconds would disagree.
       */
      const reproduces = (minutes: string, amount: string) =>
        expect(quantise(mul(fromDecimal('1200.0000'), fromDecimal(minutes)), MONEY_SCALE)).toBe(amount);
      reproduces(paid.effective_minutes, paid.amount);

      const billed = await app.inject({
        method: 'POST', url: '/api/settle/bills', headers: counter,
        payload: {
          period_start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(billed.statusCode, billed.body).toBe(200);
      expect(billed.json().bills).toHaveLength(1);
      expect(billed.json().bills[0].total).toBe(paid.amount);

      // `bill_lines` is a join and carries no money of its own; the price, the
      // minutes and the amount live on the settlement it names.
      const d = await db();
      const lines = (await d.execute(sql`
        select s.unit_price::text as unit_price,
               s.effective_minutes::text as effective_minutes,
               s.amount::text as amount
          from bill_lines l join settlements s on s.id = l.settlement_id`)) as unknown as
        { unit_price: string; effective_minutes: string; amount: string }[];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        unit_price: '1200.0000',
        effective_minutes: paid.effective_minutes,
        amount: paid.amount,
      });
      reproduces(lines[0]!.effective_minutes, lines[0]!.amount);
      expect(await counts()).toMatchObject({ reviews: 1, settlements: 1, bills: 1, lines: 1 });
    }, 300_000);

    it('leaves the bill alone when the copy is intaken again, and never wrote to the card', async () => {
      const before = await counts();
      // The copy's own path this time: already inside the media root, so nothing
      // is copied again.
      const run = await intake(join(inbox, basename(session(FIRST))));
      expect(run.code, run.stderr).toBe(0);
      expect(run.table).toMatchObject({
        copy: 'already under PLAYERONE_MEDIA_ROOT',
        ingest: 'duplicate',
        verification: 'verified',
      });
      expect(await counts()).toEqual(before);

      const d = await db();
      const rows = (await d.execute(sql`
        select s.amount::text as amount
          from bill_lines l join settlements s on s.id = l.settlement_id`)) as unknown as
        { amount: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(paid.amount);

      // Rule 6's other half: the card is read and never written. Same names,
      // same sizes, nothing added and nothing removed.
      expect(await sizes(session(FIRST))).toEqual(onCard);
    }, 600_000);
  },
);
